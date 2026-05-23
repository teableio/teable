import { describe, expect, it } from 'vitest';

import { ActorId } from '../../domain/shared/ActorId';
import type { TableDataSafetyLimitConfig } from '../../domain/shared/TableDataSafetyLimits';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import {
  ViewOperationKind,
  type ViewOperationPluginContext,
} from '../../ports/ViewOperationPlugin';
import {
  StaticTableDataSafetyLimitPlugin,
  TableDataSafetyLimitComposer,
} from './TableDataSafetyLimitComposer';
import { TableDataSafetyLimitViewOperationPlugin } from './TableDataSafetyLimitViewOperationPlugin';

type TableLimits = TableDataSafetyLimitConfig;

const actorId = ActorId.create('system')._unsafeUnwrap();

const filterItem = {
  fieldId: 'fldTest',
  operator: 'is',
  value: 'x',
  isSymbol: false,
};

const createExecutionContext = (limits?: TableLimits) =>
  ({
    actorId,
    config: limits ? { tableLimits: limits } : undefined,
  }) as IExecutionContext;

const createPlugin = (limits: TableLimits) =>
  new TableDataSafetyLimitViewOperationPlugin(
    new TableDataSafetyLimitComposer([new StaticTableDataSafetyLimitPlugin(limits)])
  );

const runPlugin = async (
  plugin: TableDataSafetyLimitViewOperationPlugin,
  context: ViewOperationPluginContext
) => {
  const preparedResult = await plugin.prepare(context);
  if (preparedResult.isErr()) return preparedResult;
  return plugin.guard(context, preparedResult.value);
};

const createContext = (
  kind: ViewOperationKind,
  payload: Record<string, unknown>,
  limits?: TableLimits
): ViewOperationPluginContext =>
  ({
    kind,
    executionContext: createExecutionContext(limits),
    payload,
    isTransactionBound: false,
  }) as unknown as ViewOperationPluginContext;

describe('TableDataSafetyLimitViewOperationPlugin', () => {
  it('supports all view operation kinds', () => {
    const plugin = createPlugin({});

    expect(plugin.supports(ViewOperationKind.create)).toBe(true);
    expect(plugin.supports(ViewOperationKind.duplicate)).toBe(true);
    expect(plugin.supports(ViewOperationKind.update)).toBe(true);
  });

  it.each([
    [ViewOperationKind.create, { tableId: 'tblTest', currentViewCount: 1, view: { name: 'Ok' } }],
    [
      ViewOperationKind.duplicate,
      { tableId: 'tblTest', currentViewCount: 1, addedViewCount: 1, view: { name: 'Ok' } },
    ],
    [ViewOperationKind.update, { tableId: 'tblTest', viewId: 'viwTest', patch: { name: 'Ok' } }],
  ] satisfies ReadonlyArray<readonly [ViewOperationKind, Record<string, unknown>]>)(
    'allows %s at configured view operation boundaries',
    async (kind, payload) => {
      const plugin = createPlugin({
        displayText: { maxNameLength: 2 },
        tableSchema: { maxViewsPerTable: 2 },
      });

      const result = await runPlugin(plugin, createContext(kind, payload));

      expect(result.isOk()).toBe(true);
    }
  );

  it.each([
    [
      'validation.limit.views_per_table_max',
      ViewOperationKind.create,
      { tableId: 'tblTest', currentViewCount: 2, view: {} },
      { tableSchema: { maxViewsPerTable: 2 } },
    ],
    [
      'validation.limit.views_per_table_max',
      ViewOperationKind.duplicate,
      { tableId: 'tblTest', currentViewCount: 1, addedViewCount: 2, view: {} },
      { tableSchema: { maxViewsPerTable: 2 } },
    ],
    [
      'validation.limit.name_max_length',
      ViewOperationKind.update,
      { tableId: 'tblTest', viewId: 'viwTest', patch: { name: 'Long' } },
      { displayText: { maxNameLength: 3 } },
    ],
    [
      'validation.limit.description_max_length',
      ViewOperationKind.update,
      { tableId: 'tblTest', viewId: 'viwTest', patch: { description: 'Long' } },
      { displayText: { maxDescriptionLength: 3 } },
    ],
    [
      'validation.limit.view_filter_items_max',
      ViewOperationKind.update,
      {
        tableId: 'tblTest',
        viewId: 'viwTest',
        patch: { filter: { conjunction: 'and', filterSet: [filterItem, filterItem] } },
      },
      { viewConfig: { maxFilterItems: 1 } },
    ],
    [
      'validation.limit.view_filter_depth_max',
      ViewOperationKind.update,
      {
        tableId: 'tblTest',
        viewId: 'viwTest',
        patch: {
          filter: {
            conjunction: 'and',
            filterSet: [{ conjunction: 'and', filterSet: [filterItem] }],
          },
        },
      },
      { viewConfig: { maxFilterDepth: 1 } },
    ],
    [
      'validation.limit.view_sort_items_max',
      ViewOperationKind.update,
      {
        tableId: 'tblTest',
        viewId: 'viwTest',
        patch: {
          sort: {
            sortObjs: [
              { fieldId: 'fldA', order: 'asc' },
              { fieldId: 'fldB', order: 'desc' },
            ],
          },
        },
      },
      { viewConfig: { maxSortItems: 1 } },
    ],
    [
      'validation.limit.view_sort_items_max',
      ViewOperationKind.update,
      {
        tableId: 'tblTest',
        viewId: 'viwTest',
        patch: {
          sort: [
            { fieldId: 'fldA', order: 'asc' },
            { fieldId: 'fldB', order: 'desc' },
          ],
        },
      },
      { viewConfig: { maxSortItems: 1 } },
    ],
    [
      'validation.limit.view_group_items_max',
      ViewOperationKind.update,
      {
        tableId: 'tblTest',
        viewId: 'viwTest',
        patch: {
          group: [
            { fieldId: 'fldA', order: 'asc' },
            { fieldId: 'fldB', order: 'desc' },
          ],
        },
      },
      { viewConfig: { maxGroupItems: 1 } },
    ],
    [
      'validation.limit.view_options_max_bytes',
      ViewOperationKind.update,
      { tableId: 'tblTest', viewId: 'viwTest', patch: { options: { rowHeight: 1 } } },
      { viewConfig: { maxOptionsBytes: 4 } },
    ],
  ] satisfies ReadonlyArray<
    readonly [string, ViewOperationKind, Record<string, unknown>, TableLimits]
  >)('rejects %s', async (expectedCode, kind, payload, limits) => {
    const result = await runPlugin(createPlugin(limits), createContext(kind, payload));

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(expectedCode);
    }
  });

  it('uses execution context table limits through the shared composer', async () => {
    const plugin = new TableDataSafetyLimitViewOperationPlugin();
    const context = createContext(
      ViewOperationKind.update,
      { tableId: 'tblTest', viewId: 'viwTest', patch: { name: 'Long' } },
      { displayText: { maxNameLength: 3 } }
    );

    const result = await runPlugin(plugin, context);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('validation.limit.name_max_length');
    }
  });
});
