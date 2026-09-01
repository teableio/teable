import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import type { ViewUndoRedoService } from '../application/services/ViewUndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldName } from '../domain/table/fields/FieldName';
import { TableUpdateViewOptionsSpec } from '../domain/table/specs/TableUpdateViewOptionsSpec';
import { Table } from '../domain/table/Table';
import type { TableUpdateResult } from '../domain/table/TableMutator';
import { TableName } from '../domain/table/TableName';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { ITableRepository } from '../ports/TableRepository';
import type { IViewOperationPlugin } from '../ports/ViewOperationPlugin';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { UpdateViewOptionsCommand } from './UpdateViewOptionsCommand';
import { UpdateViewOptionsHandler } from './UpdateViewOptionsHandler';

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
    _context: IExecutionContext,
    target: { table: Table },
    mutate: (table: Table) => Result<TableUpdateResult, DomainError>
  ) {
    this.calls += 1;
    const result = mutate(target.table);
    if (result.isErr()) return err(result.error);
    this.mutateSpec = result.value.mutateSpec;
    return ok({
      table: result.value.table,
      events: result.value.table.pullDomainEvents(),
      postPersistEvents: [],
    });
  }
}

const createHandler = (table: Table, plugins: IViewOperationPlugin[] = []) => {
  const tableRepository = { findOne: vi.fn(async () => ok(table)) } as unknown as ITableRepository;
  const tableUpdateFlow = new FakeTableUpdateFlow();
  const undoRedo = {
    capture: vi.fn((_, viewId: string) => ok({ id: viewId } as never)),
    appendUpdate: vi.fn(async () => ok(undefined)),
  } as unknown as ViewUndoRedoService;
  return {
    handler: new UpdateViewOptionsHandler(
      tableRepository,
      tableUpdateFlow as unknown as TableUpdateFlow,
      new ViewOperationPluginRunner(plugins),
      undoRedo
    ),
    tableRepository,
    tableUpdateFlow,
    undoRedo,
  };
};

describe('UpdateViewOptionsCommand', () => {
  it('validates identifiers and requires an options object', () => {
    expect(
      UpdateViewOptionsCommand.create({ tableId: 'bad', viewId: 'bad', options: {} }).isErr()
    ).toBe(true);
    const table = buildTable();
    const ids = { tableId: table.id().toString(), viewId: table.views()[0]!.id().toString() };
    expect(UpdateViewOptionsCommand.create({ ...ids, options: {} }).isOk()).toBe(true);
    expect(UpdateViewOptionsCommand.create({ ...ids, options: null }).isErr()).toBe(true);
    expect(UpdateViewOptionsCommand.create({ ...ids, options: [] }).isErr()).toBe(true);
  });
});

describe('UpdateViewOptionsHandler', () => {
  it('orchestrates aggregate mutation, policy, persistence, and v2 history', async () => {
    const table = buildTable();
    const options = { rowHeight: 'tall' };
    const prepare = vi.fn(() => ok(undefined));
    const setup = createHandler(table, [
      {
        name: 'capture',
        supports: (kind) => kind === ViewOperationKind.update,
        prepare,
        guard: () => ok(undefined),
      },
    ]);
    const command = UpdateViewOptionsCommand.create({
      tableId: table.id().toString(),
      viewId: table.views()[0]!.id().toString(),
      options,
    })._unsafeUnwrap();

    expect((await setup.handler.handle(context, command)).isOk()).toBe(true);
    expect(setup.tableRepository.findOne).toHaveBeenCalledOnce();
    expect(setup.tableUpdateFlow.mutateSpec).toBeInstanceOf(TableUpdateViewOptionsSpec);
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'update',
        payload: expect.objectContaining({ patch: { options } }),
      })
    );
    expect(setup.undoRedo.capture).toHaveBeenCalledTimes(2);
    expect(setup.undoRedo.appendUpdate).toHaveBeenCalledOnce();
  });

  it('skips policy, persistence, and history for an identical patch', async () => {
    const source = buildTable();
    const viewId = source.views()[0]!.id();
    const options = { rowHeight: 'tall' };
    const current = source.updateViewOptions(viewId, options)._unsafeUnwrap().updateResult!.table;
    current.pullDomainEvents();
    const prepare = vi.fn(() => ok(undefined));
    const setup = createHandler(current, [
      { name: 'capture', supports: () => true, prepare, guard: () => ok(undefined) },
    ]);
    const command = UpdateViewOptionsCommand.create({
      tableId: current.id().toString(),
      viewId: viewId.toString(),
      options,
    })._unsafeUnwrap();

    expect((await setup.handler.handle(context, command)).isOk()).toBe(true);
    expect(setup.tableUpdateFlow.calls).toBe(0);
    expect(prepare).not.toHaveBeenCalled();
    expect(setup.undoRedo.appendUpdate).not.toHaveBeenCalled();
  });

  it('does not persist or append history when a guard rejects', async () => {
    const table = buildTable();
    const setup = createHandler(table, [
      {
        name: 'reject',
        supports: () => true,
        guard: () => err(domainError.forbidden({ message: 'rejected' })),
      },
    ]);
    const command = UpdateViewOptionsCommand.create({
      tableId: table.id().toString(),
      viewId: table.views()[0]!.id().toString(),
      options: { rowHeight: 'tall' },
    })._unsafeUnwrap();

    expect((await setup.handler.handle(context, command))._unsafeUnwrapErr().code).toBe(
      'forbidden'
    );
    expect(setup.tableUpdateFlow.calls).toBe(0);
    expect(setup.undoRedo.appendUpdate).not.toHaveBeenCalled();
  });
});
