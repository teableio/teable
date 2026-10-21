import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import type { ViewUndoRedoService } from '../application/services/ViewUndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldName } from '../domain/table/fields/FieldName';
import { TableUpdateViewShareMetaSpec } from '../domain/table/specs/TableUpdateViewShareMetaSpec';
import { Table } from '../domain/table/Table';
import type { TableUpdateResult } from '../domain/table/TableMutator';
import { TableName } from '../domain/table/TableName';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { ITableRepository } from '../ports/TableRepository';
import type { IViewOperationPlugin } from '../ports/ViewOperationPlugin';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { UpdateViewShareMetaCommand } from './UpdateViewShareMetaCommand';
import { UpdateViewShareMetaHandler } from './UpdateViewShareMetaHandler';

const context: IExecutionContext = { actorId: ActorId.create('actor')._unsafeUnwrap() };

const buildTable = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Shared Views')._unsafeUnwrap());
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
  const repository = { findOne: vi.fn(async () => ok(table)) } as unknown as ITableRepository;
  const flow = new FakeTableUpdateFlow();
  const history = {
    capture: vi.fn((_, viewId: string) => ok({ id: viewId } as never)),
    appendUpdate: vi.fn(async () => ok(undefined)),
  } as unknown as ViewUndoRedoService;
  return {
    handler: new UpdateViewShareMetaHandler(
      repository,
      flow as unknown as TableUpdateFlow,
      new ViewOperationPluginRunner(plugins),
      history
    ),
    repository,
    flow,
    history,
  };
};

describe('UpdateViewShareMetaCommand', () => {
  it('validates ids and strict metadata values', () => {
    const table = buildTable();
    const ids = { tableId: table.id().toString(), viewId: table.views()[0]!.id().toString() };
    expect(UpdateViewShareMetaCommand.create({ ...ids, shareMeta: {} }).isOk()).toBe(true);
    expect(
      UpdateViewShareMetaCommand.create({ ...ids, shareMeta: { password: 'ab' } }).isErr()
    ).toBe(true);
    expect(
      UpdateViewShareMetaCommand.create({ ...ids, shareMeta: { unknown: true } }).isErr()
    ).toBe(true);
  });
});

describe('UpdateViewShareMetaHandler', () => {
  it('orchestrates aggregate mutation, plugin policy, persistence, and v2 history', async () => {
    const table = buildTable();
    const shareMeta = { allowCopy: true, submit: { requireLogin: true } };
    const prepare = vi.fn(() => ok(undefined));
    const setup = createHandler(table, [
      {
        name: 'capture',
        supports: (kind) => kind === ViewOperationKind.update,
        prepare,
        guard: () => ok(undefined),
      },
    ]);
    const command = UpdateViewShareMetaCommand.create({
      tableId: table.id().toString(),
      viewId: table.views()[0]!.id().toString(),
      shareMeta,
    })._unsafeUnwrap();

    expect((await setup.handler.handle(context, command)).isOk()).toBe(true);
    expect(setup.repository.findOne).toHaveBeenCalledOnce();
    expect(setup.flow.mutateSpec).toBeInstanceOf(TableUpdateViewShareMetaSpec);
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'update',
        payload: expect.objectContaining({ patch: { shareMeta } }),
      })
    );
    expect(setup.history.capture).toHaveBeenCalledTimes(2);
    expect(setup.history.appendUpdate).toHaveBeenCalledOnce();
  });

  it('skips persistence and history for an identical replacement', async () => {
    const source = buildTable();
    const viewId = source.views()[0]!.id();
    const current = source.updateViewShareMeta(viewId, {})._unsafeUnwrap().updateResult!.table;
    current.pullDomainEvents();
    const setup = createHandler(current);
    const command = UpdateViewShareMetaCommand.create({
      tableId: current.id().toString(),
      viewId: viewId.toString(),
      shareMeta: {},
    })._unsafeUnwrap();

    expect((await setup.handler.handle(context, command)).isOk()).toBe(true);
    expect(setup.flow.calls).toBe(0);
    expect(setup.history.appendUpdate).not.toHaveBeenCalled();
  });

  it('does not persist when plugin policy rejects the update', async () => {
    const table = buildTable();
    const setup = createHandler(table, [
      {
        name: 'reject',
        supports: () => true,
        guard: () => err(domainError.forbidden({ message: 'rejected' })),
      },
    ]);
    const command = UpdateViewShareMetaCommand.create({
      tableId: table.id().toString(),
      viewId: table.views()[0]!.id().toString(),
      shareMeta: { allowEdit: true },
    })._unsafeUnwrap();

    expect((await setup.handler.handle(context, command))._unsafeUnwrapErr().code).toBe(
      'forbidden'
    );
    expect(setup.flow.calls).toBe(0);
    expect(setup.history.appendUpdate).not.toHaveBeenCalled();
  });
});
