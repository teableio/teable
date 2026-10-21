import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import type { ViewUndoRedoService } from '../application/services/ViewUndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { ViewShareEnabled } from '../domain/table/events/ViewShareEnabled';
import { FieldName } from '../domain/table/fields/FieldName';
import { TableUpdateViewShareStateSpec } from '../domain/table/specs/TableUpdateViewShareStateSpec';
import { Table } from '../domain/table/Table';
import type { TableUpdateResult } from '../domain/table/TableMutator';
import { TableName } from '../domain/table/TableName';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { ITableRepository } from '../ports/TableRepository';
import type { IViewOperationPlugin } from '../ports/ViewOperationPlugin';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { EnableViewShareCommand } from './EnableViewShareCommand';
import { EnableViewShareHandler } from './EnableViewShareHandler';

const context: IExecutionContext = { actorId: ActorId.create('actor')._unsafeUnwrap() };

const buildTable = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Share lifecycle')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  table.pullDomainEvents();
  return table;
};

class FakeTableUpdateFlow {
  calls = 0;
  mutateSpec?: TableUpdateResult['mutateSpec'];

  constructor(private readonly failure?: DomainError) {}

  async execute(
    _context: IExecutionContext,
    target: { table: Table },
    mutate: (table: Table) => Result<TableUpdateResult, DomainError>
  ) {
    this.calls += 1;
    if (this.failure) return err(this.failure);
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
  flowFailure?: DomainError;
  undoFailure?: DomainError;
}) => {
  const repository = {
    findOne: vi.fn(async () => params.tableResult),
  } as unknown as ITableRepository;
  const flow = new FakeTableUpdateFlow(params.flowFailure);
  const appendShareLifecycle = vi.fn(async () =>
    params.undoFailure ? err(params.undoFailure) : ok(undefined)
  );
  const undoRedo = { appendShareLifecycle } as unknown as ViewUndoRedoService;
  const handler = new EnableViewShareHandler(
    repository,
    flow as unknown as TableUpdateFlow,
    new ViewOperationPluginRunner(params.plugins),
    undoRedo
  );
  return { handler, repository, flow, appendShareLifecycle };
};

describe('EnableViewShareCommand', () => {
  it('validates Table and View identifiers', () => {
    expect(EnableViewShareCommand.create({ tableId: 'bad', viewId: 'bad' }).isErr()).toBe(true);
  });
});

describe('EnableViewShareHandler', () => {
  it('enables sharing through the Table aggregate, plugin policy, persistence, and undo history', async () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
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
    const command = EnableViewShareCommand.create({
      tableId: table.id().toString(),
      viewId: viewId.toString(),
    })._unsafeUnwrap();

    const result = (await setup.handler.handle(context, command))._unsafeUnwrap();
    const sharedView = result.table.getView(viewId)._unsafeUnwrap();

    expect(setup.repository.findOne).toHaveBeenCalledOnce();
    expect(setup.flow.calls).toBe(1);
    expect(setup.flow.mutateSpec).toBeInstanceOf(TableUpdateViewShareStateSpec);
    expect(result.shareId).toMatch(/^shr[0-9a-zA-Z]{16}$/);
    expect(sharedView.enableShare()).toBe(true);
    expect(sharedView.shareId()).toBe(result.shareId);
    expect(result.events.some((event) => event instanceof ViewShareEnabled)).toBe(true);
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: ViewOperationKind.update,
        payload: {
          tableId: table.id().toString(),
          viewId: viewId.toString(),
          patch: {
            enableShare: true,
            shareId: result.shareId,
            shareMeta: { includeRecords: true },
          },
        },
      })
    );
    expect(setup.appendShareLifecycle).toHaveBeenCalledWith(
      context,
      result.table,
      viewId.toString(),
      'enable'
    );
  });

  it('rejects an already shared View before plugins, persistence, or undo history', async () => {
    const original = buildTable();
    const viewId = original.views()[0]!.id();
    const table = original.enableViewShare(viewId)._unsafeUnwrap().updateResult.table;
    table.pullDomainEvents();
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
    const command = EnableViewShareCommand.create({
      tableId: table.id().toString(),
      viewId: viewId.toString(),
    })._unsafeUnwrap();

    const result = await setup.handler.handle(context, command);

    expect(result._unsafeUnwrapErr().code).toBe('validation.invalid');
    expect(prepare).not.toHaveBeenCalled();
    expect(setup.flow.calls).toBe(0);
    expect(setup.appendShareLifecycle).not.toHaveBeenCalled();
  });

  it('does not persist or append history when plugin policy rejects sharing', async () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    const setup = createHandler({
      tableResult: ok(table),
      plugins: [
        {
          name: 'reject',
          supports: () => true,
          guard: () => err(domainError.forbidden({ message: 'Sharing rejected' })),
        },
      ],
    });
    const command = EnableViewShareCommand.create({
      tableId: table.id().toString(),
      viewId: viewId.toString(),
    })._unsafeUnwrap();

    const result = await setup.handler.handle(context, command);

    expect(result._unsafeUnwrapErr().code).toBe('forbidden');
    expect(setup.flow.calls).toBe(0);
    expect(setup.appendShareLifecycle).not.toHaveBeenCalled();
  });

  it('propagates repository and undo history failures at their orchestration boundaries', async () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    const command = EnableViewShareCommand.create({
      tableId: table.id().toString(),
      viewId: viewId.toString(),
    })._unsafeUnwrap();
    const missing = createHandler({
      tableResult: err(domainError.notFound({ message: 'Missing Table' })),
    });

    expect((await missing.handler.handle(context, command))._unsafeUnwrapErr().code).toBe(
      'not_found'
    );
    expect(missing.flow.calls).toBe(0);

    const undoRejected = createHandler({
      tableResult: ok(table),
      undoFailure: domainError.unexpected({ message: 'Undo store unavailable' }),
    });
    expect((await undoRejected.handler.handle(context, command))._unsafeUnwrapErr().code).toBe(
      'unexpected'
    );
    expect(undoRejected.flow.calls).toBe(1);
    expect(undoRejected.appendShareLifecycle).toHaveBeenCalledOnce();
  });
});
