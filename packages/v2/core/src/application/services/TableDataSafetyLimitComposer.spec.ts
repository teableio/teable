import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ActorId } from '../../domain/shared/ActorId';
import { domainError } from '../../domain/shared/DomainError';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ITableDataSafetyLimitPlugin } from '../../ports/TableDataSafetyLimitPlugin';
import {
  ExecutionContextTableDataSafetyLimitPlugin,
  StaticTableDataSafetyLimitPlugin,
  TableDataSafetyLimitComposer,
} from './TableDataSafetyLimitComposer';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

describe('TableDataSafetyLimitComposer', () => {
  it('returns undefined when no plugin contributes limits', async () => {
    const result = await TableDataSafetyLimitComposer.compose([], createContext());

    expect(result._unsafeUnwrap()).toBeUndefined();
  });

  it('ignores plugins that intentionally do not contribute limits', async () => {
    const plugins: ITableDataSafetyLimitPlugin[] = [
      {
        name: 'no-limit-for-context',
        contribute: () => ok(undefined),
      },
      new StaticTableDataSafetyLimitPlugin({
        tableSchema: { maxRowsPerTable: 10 },
      }),
    ];

    const result = await TableDataSafetyLimitComposer.compose(plugins, createContext());

    expect(result._unsafeUnwrap()?.tableSchema?.maxRowsPerTable).toBe(10);
  });

  it('composes plugin contributions with the strictest numeric limit', async () => {
    const plugins: ITableDataSafetyLimitPlugin[] = [
      new StaticTableDataSafetyLimitPlugin({
        tableSchema: { maxRowsPerTable: 100 },
        recordValues: { maxRecordsPerMutation: 20 },
      }),
      new StaticTableDataSafetyLimitPlugin({
        tableSchema: { maxRowsPerTable: 10 },
        recordValues: { maxRecordsPerMutation: 50 },
      }),
    ];

    const result = await TableDataSafetyLimitComposer.compose(plugins, createContext());

    expect(result._unsafeUnwrap()).toEqual({
      fieldOptions: {
        maxBytes: undefined,
        maxSelectChoices: undefined,
        maxSelectChoiceNameLength: undefined,
        maxSelectDefaultValues: undefined,
      },
      recordValues: {
        maxCellValueBytes: undefined,
        maxRecordFieldsBytes: undefined,
        maxRecordsPerMutation: 20,
      },
      computed: {
        maxComputedCellValueBytes: undefined,
        maxFormulaLength: undefined,
      },
      tableSchema: {
        maxTablesPerBase: undefined,
        maxFieldsPerTable: undefined,
        maxViewsPerTable: undefined,
        maxCreateTableFields: undefined,
        maxCreateTableViews: undefined,
        maxCreateTableRecords: undefined,
        maxRowsPerTable: 10,
      },
      viewConfig: {
        maxFilterItems: undefined,
        maxFilterDepth: undefined,
        maxSortItems: undefined,
        maxGroupItems: undefined,
        maxOptionsBytes: undefined,
      },
      displayText: {
        maxNameLength: undefined,
        maxDescriptionLength: undefined,
      },
    });
  });

  it('accepts plugins and invokes them with the execution context', async () => {
    const context = {
      ...createContext(),
      config: { tableLimits: { displayText: { maxNameLength: 3 } } },
    };

    const result = await TableDataSafetyLimitComposer.compose(
      [new ExecutionContextTableDataSafetyLimitPlugin()],
      context
    );

    expect(result._unsafeUnwrap()?.displayText?.maxNameLength).toBe(3);
  });

  it('supports instance composition from its registered plugins', async () => {
    const plugin: ITableDataSafetyLimitPlugin = {
      name: 'one-row-limit',
      contribute: () => ok({ tableSchema: { maxRowsPerTable: 1 } }),
    };

    const result = await new TableDataSafetyLimitComposer([plugin]).compose(createContext());

    expect(result._unsafeUnwrap()?.tableSchema?.maxRowsPerTable).toBe(1);
  });

  it('inspects plugin contributions and selected effective rules', async () => {
    const plugins: ITableDataSafetyLimitPlugin[] = [
      {
        name: 'loose-space-plan-limit',
        contribute: () =>
          ok({
            tableSchema: { maxRowsPerTable: 100 },
            recordValues: { maxRecordsPerMutation: 20 },
          }),
      },
      {
        name: 'strict-credit-limit',
        contribute: () =>
          ok({
            tableSchema: { maxRowsPerTable: 10 },
          }),
      },
    ];

    const result = await TableDataSafetyLimitComposer.inspect(plugins, createContext());
    const inspection = result._unsafeUnwrap();
    const rowLimitRule = inspection.rules.find(
      (rule) => rule.group === 'tableSchema' && rule.key === 'maxRowsPerTable'
    );
    const mutationLimitRule = inspection.rules.find(
      (rule) => rule.group === 'recordValues' && rule.key === 'maxRecordsPerMutation'
    );

    expect(inspection.plugins).toEqual(['loose-space-plan-limit', 'strict-credit-limit']);
    expect(inspection.contributions).toHaveLength(2);
    expect(inspection.composed?.tableSchema?.maxRowsPerTable).toBe(10);
    expect(inspection.resolved.tableSchema.maxRowsPerTable).toBe(10);
    expect(rowLimitRule).toEqual({
      group: 'tableSchema',
      key: 'maxRowsPerTable',
      effectiveValue: 10,
      defaultValue: undefined,
      sources: [
        { pluginName: 'loose-space-plan-limit', value: 100, selected: false },
        { pluginName: 'strict-credit-limit', value: 10, selected: true },
      ],
    });
    expect(mutationLimitRule).toEqual({
      group: 'recordValues',
      key: 'maxRecordsPerMutation',
      effectiveValue: 20,
      defaultValue: 20000,
      sources: [
        {
          pluginName: 'default-table-data-safety-limit',
          value: 20000,
          selected: false,
          default: true,
        },
        { pluginName: 'loose-space-plan-limit', value: 20, selected: true },
      ],
    });
  });

  it('keeps default sources selected when a plugin contributes no value for that rule', async () => {
    const result = await TableDataSafetyLimitComposer.inspect(
      [
        new StaticTableDataSafetyLimitPlugin({
          fieldOptions: { maxBytes: undefined },
        }),
      ],
      createContext()
    );
    const inspection = result._unsafeUnwrap();
    const mutationLimitRule = inspection.rules.find(
      (rule) => rule.group === 'recordValues' && rule.key === 'maxRecordsPerMutation'
    );

    expect(inspection.resolved.recordValues.maxRecordsPerMutation).toBe(20000);
    expect(mutationLimitRule).toEqual({
      group: 'recordValues',
      key: 'maxRecordsPerMutation',
      effectiveValue: 20000,
      defaultValue: 20000,
      sources: [
        {
          pluginName: 'default-table-data-safety-limit',
          value: 20000,
          selected: true,
          default: true,
        },
      ],
    });
  });

  it('returns plugin errors without composing later plugins', async () => {
    const failure = domainError.validation({
      code: 'validation.table_limit.plugin_failed',
      message: 'limit plugin failed',
    });
    let laterPluginCalled = false;
    const plugins: ITableDataSafetyLimitPlugin[] = [
      {
        name: 'failing-limit-plugin',
        contribute: () => err(failure),
      },
      {
        name: 'later-limit-plugin',
        contribute: () => {
          laterPluginCalled = true;
          return ok({ tableSchema: { maxRowsPerTable: 1 } });
        },
      },
    ];

    const result = await TableDataSafetyLimitComposer.compose(plugins, createContext());

    expect(result._unsafeUnwrapErr()).toBe(failure);
    expect(laterPluginCalled).toBe(false);
  });
});
