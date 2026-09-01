import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { ViewManualSortService } from '../application/services/ViewManualSortService';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import type { ViewUndoRedoService } from '../application/services/ViewUndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { ViewManualSortApplied } from '../domain/table/events/ViewManualSortApplied';
import { ViewSortUpdated } from '../domain/table/events/ViewSortUpdated';
import { FieldName } from '../domain/table/fields/FieldName';
import { TableUpdateViewQueryDefaultsSpec } from '../domain/table/specs/TableUpdateViewQueryDefaultsSpec';
import { Table } from '../domain/table/Table';
import type { TableUpdateResult } from '../domain/table/TableMutator';
import { TableName } from '../domain/table/TableName';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { ITableRepository } from '../ports/TableRepository';
import type { IViewOperationPlugin } from '../ports/ViewOperationPlugin';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { ApplyViewManualSortCommand } from './ApplyViewManualSortCommand';
import { ApplyViewManualSortHandler } from './ApplyViewManualSortHandler';

const context: IExecutionContext = { actorId: ActorId.create('actor')._unsafeUnwrap() };

const buildTable = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Views')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

class FakeTableUpdateFlow {
  calls = 0;
  mutateSpec?: TableUpdateResult['mutateSpec'];

  async execute(
    contextValue: IExecutionContext,
    target: { table: Table },
    mutate: (table: Table) => Result<TableUpdateResult, DomainError>,
    options?: {
      hooks?: {
        afterPersist?: (
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
    const events = result.value.table.pullDomainEvents();
    const hookResult = await options?.hooks?.afterPersist?.(
      contextValue,
      result.value.table,
      result.value.mutateSpec
    );
    if (hookResult?.isErr()) return err(hookResult.error);
    return ok({
      table: result.value.table,
      events,
      postPersistEvents: [],
    });
  }
}

const createHandler = (table: Table, plugins: IViewOperationPlugin[] = []) => {
  const tableRepository = { findOne: vi.fn(async () => ok(table)) } as unknown as ITableRepository;
  const tableUpdateFlow = new FakeTableUpdateFlow();
  const prepareStorage = vi.fn(async () => ok(undefined));
  const materialize = vi.fn(async () => ok({ updatedCount: 3 }));
  const undoRedo = {
    capture: vi.fn((_, viewId: string) => ok({ id: viewId } as never)),
    appendUpdate: vi.fn(async () => ok(undefined)),
  } as unknown as ViewUndoRedoService;
  return {
    handler: new ApplyViewManualSortHandler(
      tableRepository,
      tableUpdateFlow as unknown as TableUpdateFlow,
      { prepareStorage, materialize } as unknown as ViewManualSortService,
      new ViewOperationPluginRunner(plugins),
      undoRedo
    ),
    tableRepository,
    tableUpdateFlow,
    prepareStorage,
    materialize,
    undoRedo,
  };
};

describe('ApplyViewManualSortCommand', () => {
  it('validates identifiers, empty sort, and sort directions', () => {
    expect(
      ApplyViewManualSortCommand.create({ tableId: 'bad', viewId: 'bad', sort: [] }).isErr()
    ).toBe(true);
    const table = buildTable();
    const ids = { tableId: table.id().toString(), viewId: table.views()[0]!.id().toString() };
    expect(ApplyViewManualSortCommand.create({ ...ids, sort: [] }).isOk()).toBe(true);
    expect(
      ApplyViewManualSortCommand.create({
        ...ids,
        sort: [{ fieldId: table.getFields()[0]!.id().toString(), order: 'up' }],
      }).isErr()
    ).toBe(true);
  });
});

describe('ApplyViewManualSortHandler', () => {
  it('coordinates the Table aggregate, record materialization, plugin policy, events, and history', async () => {
    const table = buildTable();
    const sort = [{ fieldId: table.getFields()[0]!.id().toString(), order: 'desc' as const }];
    const prepare = vi.fn(() => ok(undefined));
    const setup = createHandler(table, [
      {
        name: 'capture',
        supports: (kind) => kind === ViewOperationKind.update,
        prepare,
        guard: () => ok(undefined),
      },
    ]);
    const command = ApplyViewManualSortCommand.create({
      tableId: table.id().toString(),
      viewId: table.views()[0]!.id().toString(),
      sort,
    })._unsafeUnwrap();

    const result = (await setup.handler.handle(context, command))._unsafeUnwrap();

    expect(setup.tableRepository.findOne).toHaveBeenCalledOnce();
    expect(setup.tableUpdateFlow.mutateSpec).toBeInstanceOf(TableUpdateViewQueryDefaultsSpec);
    expect(setup.prepareStorage).toHaveBeenCalledWith(context, table, expect.anything());
    expect(setup.materialize).toHaveBeenCalledWith(context, result.table, command.viewId, sort);
    expect(result.updatedRecordCount).toBe(3);
    expect(result.events.some((event) => event instanceof ViewSortUpdated)).toBe(true);
    expect(result.events.some((event) => event instanceof ViewManualSortApplied)).toBe(true);
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'update',
        payload: expect.objectContaining({
          patch: { sort: { sortObjs: sort, manualSort: true } },
        }),
      })
    );
    expect(setup.undoRedo.capture).toHaveBeenCalledTimes(2);
    expect(setup.undoRedo.appendUpdate).toHaveBeenCalledOnce();
  });

  it('skips record writes, plugins, persistence, and history for an identical manual state', async () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    const sort = [{ fieldId: table.getFields()[0]!.id().toString(), order: 'asc' as const }];
    const current = table.applyViewManualSort(viewId, sort)._unsafeUnwrap().table;
    current.pullDomainEvents();
    const prepare = vi.fn(() => ok(undefined));
    const setup = createHandler(current, [
      { name: 'capture', supports: () => true, prepare, guard: () => ok(undefined) },
    ]);
    const command = ApplyViewManualSortCommand.create({
      tableId: current.id().toString(),
      viewId: viewId.toString(),
      sort,
    })._unsafeUnwrap();

    expect((await setup.handler.handle(context, command)).isOk()).toBe(true);
    expect(setup.tableUpdateFlow.calls).toBe(0);
    expect(setup.materialize).not.toHaveBeenCalled();
    expect(setup.prepareStorage).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(setup.undoRedo.appendUpdate).not.toHaveBeenCalled();
  });

  it('does not materialize or append history when the View update guard rejects', async () => {
    const table = buildTable();
    const setup = createHandler(table, [
      {
        name: 'reject',
        supports: () => true,
        guard: () => err(domainError.forbidden({ message: 'rejected' })),
      },
    ]);
    const command = ApplyViewManualSortCommand.create({
      tableId: table.id().toString(),
      viewId: table.views()[0]!.id().toString(),
      sort: [],
    })._unsafeUnwrap();

    expect((await setup.handler.handle(context, command))._unsafeUnwrapErr().code).toBe(
      'forbidden'
    );
    expect(setup.tableUpdateFlow.calls).toBe(0);
    expect(setup.materialize).not.toHaveBeenCalled();
    expect(setup.prepareStorage).not.toHaveBeenCalled();
    expect(setup.undoRedo.appendUpdate).not.toHaveBeenCalled();
  });
});
