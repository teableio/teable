import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import type { ViewUndoRedoService } from '../application/services/ViewUndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { ViewOrderUpdated } from '../domain/table/events/ViewOrderUpdated';
import { FieldName } from '../domain/table/fields/FieldName';
import { TableUpdateViewOrderSpec } from '../domain/table/specs/TableUpdateViewOrderSpec';
import { Table } from '../domain/table/Table';
import type { TableUpdateResult } from '../domain/table/TableMutator';
import { TableName } from '../domain/table/TableName';
import { ViewOrder } from '../domain/table/views/ViewOrder';
import { captureViewSnapshot } from '../domain/table/views/ViewSnapshot';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { ITableRepository } from '../ports/TableRepository';
import type { IViewOperationPlugin } from '../ports/ViewOperationPlugin';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { UpdateViewOrderCommand } from './UpdateViewOrderCommand';
import { UpdateViewOrderHandler } from './UpdateViewOrderHandler';

const context: IExecutionContext = { actorId: ActorId.create('actor')._unsafeUnwrap() };

const buildTable = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'f'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('View order')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  let table = builder.build()._unsafeUnwrap();
  table = table.createView({ type: 'grid', name: 'Second' })._unsafeUnwrap().updateResult.table;
  table = table.createView({ type: 'grid', name: 'Third' })._unsafeUnwrap().updateResult.table;
  table.pullDomainEvents();
  table.views().forEach((view, index) => {
    view.setOrder(ViewOrder.rehydrate(index)._unsafeUnwrap())._unsafeUnwrap();
  });
  return table;
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

const createHandler = (params: {
  tableResult: Result<Table, DomainError>;
  plugins?: IViewOperationPlugin[];
  undoFailure?: DomainError;
}) => {
  const repository = {
    findOne: vi.fn(async () => params.tableResult),
  } as unknown as ITableRepository;
  const flow = new FakeTableUpdateFlow();
  const captureAll = vi.fn((table: Table) =>
    ok(table.views().map((view) => captureViewSnapshot(view)._unsafeUnwrap()))
  );
  const appendUpdate = vi.fn(async () =>
    params.undoFailure ? err(params.undoFailure) : ok(undefined)
  );
  const handler = new UpdateViewOrderHandler(
    repository,
    flow as unknown as TableUpdateFlow,
    new ViewOperationPluginRunner(params.plugins),
    { captureAll, appendUpdate } as unknown as ViewUndoRedoService
  );
  return { handler, repository, flow, captureAll, appendUpdate };
};

describe('UpdateViewOrderCommand', () => {
  it('validates Table/View IDs and before/after positions', () => {
    const table = buildTable();
    const [source, anchor] = table.views();
    expect(
      UpdateViewOrderCommand.create({
        tableId: table.id().toString(),
        viewId: source!.id().toString(),
        anchorId: anchor!.id().toString(),
        position: 'before',
      }).isOk()
    ).toBe(true);
    expect(
      UpdateViewOrderCommand.create({
        tableId: table.id().toString(),
        viewId: source!.id().toString(),
        anchorId: anchor!.id().toString(),
        position: 'middle',
      }).isErr()
    ).toBe(true);
  });
});

describe('UpdateViewOrderHandler', () => {
  it('reorders through Table behavior, plugin policy, persistence, events, and aggregate snapshots', async () => {
    const table = buildTable();
    const [, anchor, source] = table.views();
    const prepare = vi.fn(() => ok(undefined));
    const setup = createHandler({
      tableResult: ok(table),
      plugins: [
        {
          name: 'capture',
          supports: (kind) => kind === ViewOperationKind.update,
          prepare,
          guard: () => ok(undefined),
        },
      ],
    });
    const command = UpdateViewOrderCommand.create({
      tableId: table.id().toString(),
      viewId: source!.id().toString(),
      anchorId: anchor!.id().toString(),
      position: 'before',
    })._unsafeUnwrap();

    const result = (await setup.handler.handle(context, command))._unsafeUnwrap();

    expect(setup.repository.findOne).toHaveBeenCalledOnce();
    expect(setup.flow.mutateSpec).toBeInstanceOf(TableUpdateViewOrderSpec);
    expect(result.previousOrder.toNumber()).toBe(2);
    expect(result.nextOrder.toNumber()).toBe(0.5);
    expect(result.changes).toHaveLength(1);
    expect(result.events.some((event) => event instanceof ViewOrderUpdated)).toBe(true);
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: ViewOperationKind.update,
        payload: {
          tableId: table.id().toString(),
          viewId: source!.id().toString(),
          patch: { order: 0.5 },
        },
      })
    );
    expect(setup.captureAll).toHaveBeenCalledTimes(2);
    expect(setup.appendUpdate).toHaveBeenCalledWith(
      context,
      result.table,
      expect.arrayContaining([expect.objectContaining({ id: source!.id().toString() })]),
      expect.arrayContaining([expect.objectContaining({ id: source!.id().toString() })])
    );
  });

  it('returns a missing-anchor error before plugins, persistence, or next snapshots', async () => {
    const table = buildTable();
    const prepare = vi.fn(() => ok(undefined));
    const setup = createHandler({
      tableResult: ok(table),
      plugins: [{ name: 'capture', supports: () => true, prepare }],
    });
    const command = UpdateViewOrderCommand.create({
      tableId: table.id().toString(),
      viewId: table.views()[0]!.id().toString(),
      anchorId: `viw${'z'.repeat(16)}`,
      position: 'after',
    })._unsafeUnwrap();

    expect((await setup.handler.handle(context, command))._unsafeUnwrapErr().code).toBe(
      'view.anchor_not_found'
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(setup.flow.calls).toBe(0);
    expect(setup.captureAll).toHaveBeenCalledOnce();
    expect(setup.appendUpdate).not.toHaveBeenCalled();
  });

  it('does not persist or append undo when plugin policy rejects the reorder', async () => {
    const table = buildTable();
    const [source, anchor] = table.views();
    const setup = createHandler({
      tableResult: ok(table),
      plugins: [
        {
          name: 'reject',
          supports: () => true,
          guard: () => err(domainError.forbidden({ message: 'Reorder rejected' })),
        },
      ],
    });
    const command = UpdateViewOrderCommand.create({
      tableId: table.id().toString(),
      viewId: source!.id().toString(),
      anchorId: anchor!.id().toString(),
      position: 'after',
    })._unsafeUnwrap();

    expect((await setup.handler.handle(context, command))._unsafeUnwrapErr().code).toBe(
      'forbidden'
    );
    expect(setup.flow.calls).toBe(0);
    expect(setup.captureAll).toHaveBeenCalledOnce();
    expect(setup.appendUpdate).not.toHaveBeenCalled();
  });

  it('propagates repository and undo failures at their orchestration boundaries', async () => {
    const table = buildTable();
    const [source, anchor] = table.views();
    const command = UpdateViewOrderCommand.create({
      tableId: table.id().toString(),
      viewId: source!.id().toString(),
      anchorId: anchor!.id().toString(),
      position: 'after',
    })._unsafeUnwrap();
    const missing = createHandler({
      tableResult: err(domainError.notFound({ message: 'Missing Table' })),
    });
    expect((await missing.handler.handle(context, command))._unsafeUnwrapErr().code).toBe(
      'not_found'
    );
    expect(missing.captureAll).not.toHaveBeenCalled();
    expect(missing.flow.calls).toBe(0);

    const undoRejected = createHandler({
      tableResult: ok(table),
      undoFailure: domainError.unexpected({ message: 'Undo store unavailable' }),
    });
    expect((await undoRejected.handler.handle(context, command))._unsafeUnwrapErr().code).toBe(
      'unexpected'
    );
    expect(undoRejected.flow.calls).toBe(1);
    expect(undoRejected.captureAll).toHaveBeenCalledTimes(2);
    expect(undoRejected.appendUpdate).toHaveBeenCalledOnce();
  });
});
