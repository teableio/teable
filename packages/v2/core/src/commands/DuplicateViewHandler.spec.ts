import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import { ViewPluginCreationService } from '../application/services/ViewPluginCreationService';
import type { ViewUndoRedoService } from '../application/services/ViewUndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldName } from '../domain/table/fields/FieldName';
import { TableAddViewSpec } from '../domain/table/specs/TableAddViewSpec';
import { Table } from '../domain/table/Table';
import type { TableUpdateResult } from '../domain/table/TableMutator';
import { TableName } from '../domain/table/TableName';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { ITableRepository } from '../ports/TableRepository';
import type { IViewOperationPlugin } from '../ports/ViewOperationPlugin';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import type { IViewPluginRepository, ViewPluginInstallation } from '../ports/ViewPluginRepository';
import { DuplicateViewCommand } from './DuplicateViewCommand';
import { DuplicateViewHandler } from './DuplicateViewHandler';

const context: IExecutionContext = {
  actorId: ActorId.create('actor')._unsafeUnwrap(),
};

const buildTable = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Views')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildPluginRepository = (): IViewPluginRepository => ({
  findViewPlugin: vi.fn(async () =>
    ok({
      id: 'plg-view',
      name: 'Plugin',
      logo: 'https://example.test/plugin.png',
    })
  ),
  findViewPluginInstallationByViewId: vi.fn(async () =>
    ok({ storage: JSON.stringify({ copied: true }) })
  ),
  insertViewPluginInstallation: vi.fn(async () => ok(undefined)),
  getViewPluginInstallation: vi.fn(async () => err(domainError.notFound({ message: 'Not used' }))),
  updateViewPluginStorage: vi.fn(async () => err(domainError.notFound({ message: 'Not used' }))),
});

class FakeTableUpdateFlow {
  calls = 0;
  mutateSpec?: TableUpdateResult['mutateSpec'];

  async execute(
    currentContext: IExecutionContext,
    target: { table: Table },
    mutate: (table: Table) => Result<TableUpdateResult, DomainError>,
    options?: {
      hooks?: {
        prepare?: (
          context: IExecutionContext,
          table: Table,
          spec: TableUpdateResult['mutateSpec']
        ) => Promise<Result<ReadonlyArray<never>, DomainError>>;
      };
    }
  ) {
    this.calls += 1;
    const result = mutate(target.table);
    if (result.isErr()) return err(result.error);
    this.mutateSpec = result.value.mutateSpec;
    if (options?.hooks?.prepare) {
      const hookResult = await options.hooks.prepare(
        currentContext,
        result.value.table,
        result.value.mutateSpec
      );
      if (hookResult.isErr()) return err(hookResult.error);
    }
    return ok({ table: result.value.table, events: [], postPersistEvents: [] });
  }
}

const createHandler = (
  table: Table,
  pluginRepository = buildPluginRepository(),
  operationPlugins: IViewOperationPlugin[] = []
) => {
  const tableRepository = {
    findOne: vi.fn(async () => ok(table)),
  } as unknown as ITableRepository;
  const tableUpdateFlow = new FakeTableUpdateFlow();
  const pluginService = new ViewPluginCreationService(pluginRepository);
  const pluginRunner = new ViewOperationPluginRunner(operationPlugins);
  const undoRedo = {
    capture: vi.fn((_table: Table, viewId: string) => ok({ id: viewId } as never)),
    appendCreate: vi.fn(async () => ok(undefined)),
  } as unknown as ViewUndoRedoService;
  const handler = new DuplicateViewHandler(
    tableRepository,
    tableUpdateFlow as unknown as TableUpdateFlow,
    pluginRunner,
    pluginService,
    undoRedo
  );
  return { handler, tableRepository, tableUpdateFlow, pluginRepository };
};

describe('DuplicateViewCommand', () => {
  it('validates Table and View identifiers', () => {
    expect(DuplicateViewCommand.create({ tableId: 'bad', viewId: 'bad' }).isErr()).toBe(true);
  });
});

describe('DuplicateViewHandler', () => {
  it('orchestrates the Table aggregate, duplicate operation plugin, and TableAddViewSpec', async () => {
    const table = buildTable();
    const sourceView = table.views()[0]!;
    const seenOperations: unknown[] = [];
    const operationPlugin: IViewOperationPlugin = {
      name: 'capture',
      supports: (kind) => kind === ViewOperationKind.duplicate,
      prepare: (pluginContext) => {
        seenOperations.push(pluginContext);
        return ok(undefined);
      },
      guard: () => ok(undefined),
    };
    const setup = createHandler(table, buildPluginRepository(), [operationPlugin]);
    const command = DuplicateViewCommand.create({
      tableId: table.id().toString(),
      viewId: sourceView.id().toString(),
    })._unsafeUnwrap();

    const result = await setup.handler.handle(context, command);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().table.views()).toHaveLength(2);
    expect(result._unsafeUnwrap().viewId.equals(sourceView.id())).toBe(false);
    expect(setup.tableRepository.findOne).toHaveBeenCalledOnce();
    expect(setup.tableUpdateFlow.calls).toBe(1);
    expect(setup.tableUpdateFlow.mutateSpec).toBeInstanceOf(TableAddViewSpec);
    expect(seenOperations).toEqual([
      expect.objectContaining({
        kind: 'duplicate',
        payload: expect.objectContaining({
          tableId: table.id().toString(),
          currentViewCount: 1,
          addedViewCount: 1,
          sourceViewId: sourceView.id().toString(),
        }),
      }),
    ]);
  });

  it('copies Plugin storage into the new installation in the persistence transaction', async () => {
    const baseTable = buildTable();
    const sourceResult = baseTable
      .createView({
        type: 'plugin',
        name: 'Plugin',
        options: {
          pluginId: 'plg-view',
          pluginInstallId: 'pli-stale-option',
          pluginLogo: 'old-logo',
        },
      })
      ._unsafeUnwrap();
    const table = sourceResult.updateResult.table;
    const pluginRepository = buildPluginRepository();
    const setup = createHandler(table, pluginRepository);
    const command = DuplicateViewCommand.create({
      tableId: table.id().toString(),
      viewId: sourceResult.view.id().toString(),
    })._unsafeUnwrap();

    const result = await setup.handler.handle(context, command);

    expect(result.isOk()).toBe(true);
    expect(pluginRepository.findViewPluginInstallationByViewId).toHaveBeenCalledWith(
      context,
      sourceResult.view.id().toString()
    );
    const installation = vi.mocked(pluginRepository.insertViewPluginInstallation).mock
      .calls[0]?.[1] as ViewPluginInstallation;
    const duplicatedView = result
      ._unsafeUnwrap()
      .table.getView(result._unsafeUnwrap().viewId)
      ._unsafeUnwrap();
    expect(installation.storage).toBe(JSON.stringify({ copied: true }));
    expect(installation.viewId).toBe(duplicatedView.id().toString());
    expect((duplicatedView.options() as { pluginInstallId: string }).pluginInstallId).toBe(
      installation.id
    );
    expect(installation.id).not.toBe('pli-stale-option');
  });

  it('does not persist when the duplicate operation guard rejects the request', async () => {
    const table = buildTable();
    const operationPlugin: IViewOperationPlugin = {
      name: 'reject',
      supports: (kind) => kind === ViewOperationKind.duplicate,
      guard: () => err(domainError.forbidden({ message: 'View limit reached' })),
    };
    const setup = createHandler(table, buildPluginRepository(), [operationPlugin]);
    const command = DuplicateViewCommand.create({
      tableId: table.id().toString(),
      viewId: table.views()[0]!.id().toString(),
    })._unsafeUnwrap();

    const result = await setup.handler.handle(context, command);

    expect(result._unsafeUnwrapErr().code).toBe('forbidden');
    expect(setup.tableUpdateFlow.calls).toBe(0);
  });
});
