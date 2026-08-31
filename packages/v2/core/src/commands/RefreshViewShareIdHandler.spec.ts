import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { ViewShareIdRefreshed } from '../domain/table/events/ViewShareIdRefreshed';
import { FieldName } from '../domain/table/fields/FieldName';
import { TableUpdateViewShareIdSpec } from '../domain/table/specs/TableUpdateViewShareIdSpec';
import { Table } from '../domain/table/Table';
import type { TableUpdateResult } from '../domain/table/TableMutator';
import { TableName } from '../domain/table/TableName';
import type { ViewId } from '../domain/table/views/ViewId';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { ITableRepository } from '../ports/TableRepository';
import type { IViewOperationPlugin } from '../ports/ViewOperationPlugin';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { RefreshViewShareIdCommand } from './RefreshViewShareIdCommand';
import { RefreshViewShareIdHandler } from './RefreshViewShareIdHandler';

const context: IExecutionContext = { actorId: ActorId.create('actor')._unsafeUnwrap() };

const buildSharedTable = (): { table: Table; viewId: ViewId } => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Shared Views')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  const created = builder
    .build()
    ._unsafeUnwrap()
    .createView({
      type: 'grid',
      name: 'Public View',
      enableShare: true,
      shareId: `shr${'s'.repeat(16)}`,
    })
    ._unsafeUnwrap();
  created.updateResult.table.pullDomainEvents();
  return { table: created.updateResult.table, viewId: created.view.id() };
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

const createHandlerFromResult = (
  tableResult: Result<Table, DomainError>,
  plugins: IViewOperationPlugin[] = []
) => {
  const repository = {
    findOne: vi.fn(async () => tableResult),
  } as unknown as ITableRepository;
  const flow = new FakeTableUpdateFlow();
  return {
    handler: new RefreshViewShareIdHandler(
      repository,
      flow as unknown as TableUpdateFlow,
      new ViewOperationPluginRunner(plugins)
    ),
    repository,
    flow,
  };
};

const createHandler = (table: Table, plugins: IViewOperationPlugin[] = []) =>
  createHandlerFromResult(ok(table), plugins);

describe('RefreshViewShareIdCommand', () => {
  it('validates aggregate and child IDs', () => {
    const { table, viewId } = buildSharedTable();
    expect(
      RefreshViewShareIdCommand.create({
        tableId: table.id().toString(),
        viewId: viewId.toString(),
      }).isOk()
    ).toBe(true);
    expect(RefreshViewShareIdCommand.create({ tableId: 'bad', viewId: 'bad' }).isErr()).toBe(true);
  });
});

describe('RefreshViewShareIdHandler', () => {
  it('orchestrates aggregate rotation, plugin policy, and persistence without snapshot history', async () => {
    const { table, viewId } = buildSharedTable();
    const previousShareId = table.getView(viewId)._unsafeUnwrap().shareId();
    const prepare = vi.fn(() => ok(undefined));
    const setup = createHandler(table, [
      {
        name: 'capture',
        supports: (kind) => kind === ViewOperationKind.update,
        prepare,
        guard: () => ok(undefined),
      },
    ]);
    const command = RefreshViewShareIdCommand.create({
      tableId: table.id().toString(),
      viewId: viewId.toString(),
    })._unsafeUnwrap();

    const result = (await setup.handler.handle(context, command))._unsafeUnwrap();

    expect(setup.repository.findOne).toHaveBeenCalledOnce();
    expect(setup.flow.mutateSpec).toBeInstanceOf(TableUpdateViewShareIdSpec);
    expect(result.previousShareId).toBe(previousShareId);
    expect(result.shareId).toMatch(/^shr[0-9a-zA-Z]{16}$/);
    expect(result.shareId).not.toBe(previousShareId);
    expect(result.table.getView(viewId)._unsafeUnwrap().shareId()).toBe(result.shareId);
    expect(result.events.some((event) => event instanceof ViewShareIdRefreshed)).toBe(true);
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'update',
        payload: expect.objectContaining({ patch: { shareId: result.shareId } }),
      })
    );
  });

  it('does not persist when plugin policy rejects the rotation', async () => {
    const { table, viewId } = buildSharedTable();
    const setup = createHandler(table, [
      {
        name: 'reject',
        supports: () => true,
        guard: () => err(domainError.forbidden({ message: 'rejected' })),
      },
    ]);
    const command = RefreshViewShareIdCommand.create({
      tableId: table.id().toString(),
      viewId: viewId.toString(),
    })._unsafeUnwrap();

    expect((await setup.handler.handle(context, command))._unsafeUnwrapErr().code).toBe(
      'forbidden'
    );
    expect(setup.flow.calls).toBe(0);
  });

  it('rejects rotation for a disabled View before plugin policy or persistence', async () => {
    const shared = buildSharedTable();
    const table = shared.table.disableViewShare(shared.viewId)._unsafeUnwrap().updateResult.table;
    table.pullDomainEvents();
    const prepare = vi.fn(() => ok(undefined));
    const setup = createHandler(table, [
      {
        name: 'capture',
        supports: () => true,
        prepare,
      },
    ]);
    const command = RefreshViewShareIdCommand.create({
      tableId: table.id().toString(),
      viewId: shared.viewId.toString(),
    })._unsafeUnwrap();

    const result = await setup.handler.handle(context, command);

    expect(result._unsafeUnwrapErr().code).toBe('validation.invalid');
    expect(prepare).not.toHaveBeenCalled();
    expect(setup.flow.calls).toBe(0);
  });

  it('propagates repository failure before aggregate mutation or plugin policy', async () => {
    const { table, viewId } = buildSharedTable();
    const prepare = vi.fn(() => ok(undefined));
    const setup = createHandlerFromResult(err(domainError.notFound({ message: 'Missing Table' })), [
      {
        name: 'capture',
        supports: () => true,
        prepare,
      },
    ]);
    const command = RefreshViewShareIdCommand.create({
      tableId: table.id().toString(),
      viewId: viewId.toString(),
    })._unsafeUnwrap();

    const result = await setup.handler.handle(context, command);

    expect(result._unsafeUnwrapErr().code).toBe('not_found');
    expect(prepare).not.toHaveBeenCalled();
    expect(setup.flow.calls).toBe(0);
  });
});
