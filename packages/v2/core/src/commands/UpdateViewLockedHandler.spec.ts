import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import type { ViewUndoRedoService } from '../application/services/ViewUndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldName } from '../domain/table/fields/FieldName';
import { TableUpdateViewLockedSpec } from '../domain/table/specs/TableUpdateViewLockedSpec';
import { Table } from '../domain/table/Table';
import type { TableUpdateResult } from '../domain/table/TableMutator';
import { TableName } from '../domain/table/TableName';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { ITableRepository } from '../ports/TableRepository';
import type { IViewOperationPlugin } from '../ports/ViewOperationPlugin';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { UpdateViewLockedCommand } from './UpdateViewLockedCommand';
import { UpdateViewLockedHandler } from './UpdateViewLockedHandler';

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

class FakeTableUpdateFlow {
  calls = 0;
  mutateSpec?: TableUpdateResult['mutateSpec'];

  async execute(
    _context: IExecutionContext,
    target: { table: Table },
    mutate: (table: Table) => Result<TableUpdateResult, DomainError>
  ) {
    this.calls += 1;
    const result = mutate(target.table);
    if (result.isErr()) return err(result.error);
    this.mutateSpec = result.value.mutateSpec;
    return ok({ table: result.value.table, events: [], postPersistEvents: [] });
  }
}

const createHandler = (table: Table, operationPlugins: IViewOperationPlugin[] = []) => {
  const tableRepository = {
    findOne: vi.fn(async () => ok(table)),
  } as unknown as ITableRepository;
  const tableUpdateFlow = new FakeTableUpdateFlow();
  const pluginRunner = new ViewOperationPluginRunner(operationPlugins);
  const undoRedo = {
    capture: vi.fn(() => ok({ id: table.views()[0]!.id().toString() } as never)),
    appendUpdate: vi.fn(async () => ok(undefined)),
  } as unknown as ViewUndoRedoService;
  const handler = new UpdateViewLockedHandler(
    tableRepository,
    tableUpdateFlow as unknown as TableUpdateFlow,
    pluginRunner,
    undoRedo
  );
  return { handler, tableRepository, tableUpdateFlow };
};

describe('UpdateViewLockedCommand', () => {
  it('validates identifiers and accepts true, false, and omitted locked states', () => {
    expect(UpdateViewLockedCommand.create({ tableId: 'bad', viewId: 'bad' }).isErr()).toBe(true);
    const table = buildTable();
    const base = { tableId: table.id().toString(), viewId: table.views()[0]!.id().toString() };
    expect(UpdateViewLockedCommand.create({ ...base, isLocked: true }).isOk()).toBe(true);
    expect(UpdateViewLockedCommand.create({ ...base, isLocked: false }).isOk()).toBe(true);
    expect(UpdateViewLockedCommand.create(base).isOk()).toBe(true);
    expect(UpdateViewLockedCommand.create({ ...base, isLocked: 'true' }).isErr()).toBe(true);
  });
});

describe('UpdateViewLockedHandler', () => {
  it('orchestrates the Table aggregate, update guard, and locked-state spec', async () => {
    const table = buildTable();
    const target = table.views()[0]!;
    const seenOperations: unknown[] = [];
    const operationPlugin: IViewOperationPlugin = {
      name: 'capture',
      supports: (kind) => kind === ViewOperationKind.update,
      prepare: (pluginContext) => {
        seenOperations.push(pluginContext);
        return ok(undefined);
      },
      guard: () => ok(undefined),
    };
    const setup = createHandler(table, [operationPlugin]);
    const command = UpdateViewLockedCommand.create({
      tableId: table.id().toString(),
      viewId: target.id().toString(),
      isLocked: true,
    })._unsafeUnwrap();

    const result = await setup.handler.handle(context, command);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().previousIsLocked).toBeUndefined();
    expect(result._unsafeUnwrap().nextIsLocked).toBe(true);
    expect(result._unsafeUnwrap().table.getView(target.id())._unsafeUnwrap().isLocked()).toBe(true);
    expect(setup.tableRepository.findOne).toHaveBeenCalledOnce();
    expect(setup.tableUpdateFlow.calls).toBe(1);
    expect(setup.tableUpdateFlow.mutateSpec).toBeInstanceOf(TableUpdateViewLockedSpec);
    expect(seenOperations).toEqual([
      expect.objectContaining({
        kind: 'update',
        payload: {
          tableId: table.id().toString(),
          viewId: target.id().toString(),
          patch: { isLocked: true },
        },
      }),
    ]);
  });

  it('persists an omitted locked state as an aggregate-owned property removal', async () => {
    const table = buildTable();
    const target = table.views()[0]!;
    const locked = table.updateViewLocked(target.id(), true)._unsafeUnwrap().updateResult.table;
    const setup = createHandler(locked);
    const command = UpdateViewLockedCommand.create({
      tableId: locked.id().toString(),
      viewId: target.id().toString(),
    })._unsafeUnwrap();

    const result = await setup.handler.handle(context, command);

    expect(result._unsafeUnwrap().previousIsLocked).toBe(true);
    expect(result._unsafeUnwrap().nextIsLocked).toBeUndefined();
    expect(
      result._unsafeUnwrap().table.getView(target.id())._unsafeUnwrap().isLocked()
    ).toBeUndefined();
    expect(setup.tableUpdateFlow.calls).toBe(1);
  });

  it('does not persist when the update operation guard rejects the request', async () => {
    const table = buildTable();
    const operationPlugin: IViewOperationPlugin = {
      name: 'reject',
      supports: (kind) => kind === ViewOperationKind.update,
      guard: () => err(domainError.forbidden({ message: 'View update rejected' })),
    };
    const setup = createHandler(table, [operationPlugin]);
    const command = UpdateViewLockedCommand.create({
      tableId: table.id().toString(),
      viewId: table.views()[0]!.id().toString(),
      isLocked: true,
    })._unsafeUnwrap();

    const result = await setup.handler.handle(context, command);

    expect(result._unsafeUnwrapErr().code).toBe('forbidden');
    expect(setup.tableUpdateFlow.calls).toBe(0);
  });

  it('returns an aggregate error and skips persistence for a missing View', async () => {
    const table = buildTable();
    const setup = createHandler(table);
    const command = UpdateViewLockedCommand.create({
      tableId: table.id().toString(),
      viewId: `viw${'z'.repeat(16)}`,
      isLocked: true,
    })._unsafeUnwrap();

    const result = await setup.handler.handle(context, command);

    expect(result._unsafeUnwrapErr().code).toBe('view.not_found');
    expect(setup.tableUpdateFlow.calls).toBe(0);
  });
});
