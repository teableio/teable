import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldName } from '../domain/table/fields/FieldName';
import { TableAddViewSpec } from '../domain/table/specs/TableAddViewSpec';
import { Table } from '../domain/table/Table';
import type { TableUpdateResult } from '../domain/table/TableMutator';
import { TableName } from '../domain/table/TableName';
import { captureViewSnapshot, type ViewSnapshotValue } from '../domain/table/views/ViewSnapshot';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { ITableRepository } from '../ports/TableRepository';
import type { IViewOperationPlugin } from '../ports/ViewOperationPlugin';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { ApplyViewSnapshotCommand } from './ApplyViewSnapshotCommand';
import { ApplyViewSnapshotHandler } from './ApplyViewSnapshotHandler';

const context: IExecutionContext = { actorId: ActorId.create('actor')._unsafeUnwrap() };

const buildTable = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'c'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Snapshot replay')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  table.pullDomainEvents();
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
}) => {
  const repository = {
    findOne: vi.fn(async () => params.tableResult),
  } as unknown as ITableRepository;
  const flow = new FakeTableUpdateFlow();
  const handler = new ApplyViewSnapshotHandler(
    repository,
    flow as unknown as TableUpdateFlow,
    new ViewOperationPluginRunner(params.plugins)
  );
  return { handler, repository, flow };
};

const commandFor = (table: Table, snapshot: ViewSnapshotValue): ApplyViewSnapshotCommand =>
  ApplyViewSnapshotCommand.create({
    tableId: table.id().toString(),
    snapshot,
  })._unsafeUnwrap();

describe('ApplyViewSnapshotCommand', () => {
  it('validates the Table identifier and complete snapshot shape', () => {
    const table = buildTable();
    const snapshot = captureViewSnapshot(table.views()[0]!)._unsafeUnwrap();

    expect(
      ApplyViewSnapshotCommand.create({ tableId: table.id().toString(), snapshot }).isOk()
    ).toBe(true);
    expect(ApplyViewSnapshotCommand.create({ tableId: 'bad', snapshot }).isErr()).toBe(true);
    expect(
      ApplyViewSnapshotCommand.create({
        tableId: table.id().toString(),
        snapshot: { ...snapshot, properties: { unexpected: true } },
      }).isErr()
    ).toBe(true);
  });
});

describe('ApplyViewSnapshotHandler', () => {
  it('updates an existing View through aggregate behavior and the update plugin boundary', async () => {
    const table = buildTable();
    const current = table.views()[0]!;
    const snapshot: ViewSnapshotValue = {
      ...captureViewSnapshot(current)._unsafeUnwrap(),
      name: 'Restored name',
      properties: {
        description: 'Restored description',
        isLocked: true,
        shareMeta: { allowCopy: false },
      },
    };
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

    const result = (
      await setup.handler.handle(context, commandFor(table, snapshot))
    )._unsafeUnwrap();
    const restored = result.table.getView(current.id())._unsafeUnwrap();

    expect(setup.repository.findOne).toHaveBeenCalledOnce();
    expect(setup.flow.calls).toBe(1);
    expect(restored.name().toString()).toBe('Restored name');
    expect(restored.description()).toBe('Restored description');
    expect(restored.isLocked()).toBe(true);
    expect(restored.shareMeta()).toEqual({ allowCopy: false });
    expect(result.table.pullDomainEvents()).toHaveLength(0);
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: ViewOperationKind.update,
        payload: expect.objectContaining({
          tableId: table.id().toString(),
          viewId: current.id().toString(),
          patch: expect.objectContaining({
            name: 'Restored name',
            description: 'Restored description',
            isLocked: true,
            shareMeta: { allowCopy: false },
          }),
        }),
      })
    );
  });

  it('restores a missing child as an unshared View through the Table create boundary', async () => {
    const table = buildTable();
    const created = table
      .createView({
        type: 'grid',
        name: 'Deleted shared View',
        description: 'Restore me',
        enableShare: true,
        shareId: `shr${'r'.repeat(16)}`,
      })
      ._unsafeUnwrap();
    const captured = captureViewSnapshot(created.view)._unsafeUnwrap();
    const legacySnapshot: ViewSnapshotValue = {
      ...captured,
      properties: {
        ...captured.properties,
        enableShare: true,
        shareId: `shr${'x'.repeat(16)}`,
      },
    };
    const prepare = vi.fn(() => ok(undefined));
    const setup = createHandler({
      tableResult: ok(table),
      plugins: [
        {
          name: 'capture',
          supports: (kind) => kind === ViewOperationKind.create,
          prepare,
          guard: () => ok(undefined),
        },
      ],
    });

    const result = (
      await setup.handler.handle(context, commandFor(table, legacySnapshot))
    )._unsafeUnwrap();
    const restored = result.table.getView(created.view.id())._unsafeUnwrap();

    expect(setup.flow.mutateSpec).toBeInstanceOf(TableAddViewSpec);
    expect(restored.enableShare()).toBeUndefined();
    expect(restored.shareId()).toBeUndefined();
    expect(restored.description()).toBe('Restore me');
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: ViewOperationKind.create,
        payload: expect.objectContaining({
          tableId: table.id().toString(),
          currentViewCount: 1,
          addedViewCount: 1,
          view: expect.objectContaining({
            name: 'Deleted shared View',
            description: 'Restore me',
          }),
        }),
      })
    );
  });

  it('returns without plugins or persistence when the snapshot is identical', async () => {
    const table = buildTable();
    const snapshot = captureViewSnapshot(table.views()[0]!)._unsafeUnwrap();
    const prepare = vi.fn(() => ok(undefined));
    const setup = createHandler({
      tableResult: ok(table),
      plugins: [
        {
          name: 'capture',
          supports: () => true,
          prepare,
        },
      ],
    });

    const result = await setup.handler.handle(context, commandFor(table, snapshot));

    expect(result._unsafeUnwrap().table).toBe(table);
    expect(prepare).not.toHaveBeenCalled();
    expect(setup.flow.calls).toBe(0);
  });

  it('does not persist a changed snapshot when plugin policy rejects replay', async () => {
    const table = buildTable();
    const snapshot: ViewSnapshotValue = {
      ...captureViewSnapshot(table.views()[0]!)._unsafeUnwrap(),
      name: 'Rejected replay',
    };
    const setup = createHandler({
      tableResult: ok(table),
      plugins: [
        {
          name: 'reject',
          supports: () => true,
          guard: () => err(domainError.forbidden({ message: 'Replay rejected' })),
        },
      ],
    });

    const result = await setup.handler.handle(context, commandFor(table, snapshot));

    expect(result._unsafeUnwrapErr().code).toBe('forbidden');
    expect(setup.flow.calls).toBe(0);
  });

  it('propagates repository and snapshot rehydration failures before persistence', async () => {
    const table = buildTable();
    const snapshot = captureViewSnapshot(table.views()[0]!)._unsafeUnwrap();
    const missing = createHandler({
      tableResult: err(domainError.notFound({ message: 'Missing Table' })),
    });

    expect(
      (await missing.handler.handle(context, commandFor(table, snapshot)))._unsafeUnwrapErr().code
    ).toBe('not_found');
    expect(missing.flow.calls).toBe(0);

    const invalidSnapshot = { ...snapshot, id: 'invalid-view-id' };
    const invalid = createHandler({ tableResult: ok(table) });
    const result = await invalid.handler.handle(context, commandFor(table, invalidSnapshot));

    expect(result._unsafeUnwrapErr().code).toBe('validation.invalid');
    expect(invalid.flow.calls).toBe(0);
  });
});
