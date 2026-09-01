import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import type { ViewUndoRedoService } from '../application/services/ViewUndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { ViewColumnMetaUpdated } from '../domain/table/events/ViewColumnMetaUpdated';
import { FieldName } from '../domain/table/fields/FieldName';
import { TableUpdateViewColumnMetaSpec } from '../domain/table/specs/TableUpdateViewColumnMetaSpec';
import { Table } from '../domain/table/Table';
import type { TableUpdateResult } from '../domain/table/TableMutator';
import { TableName } from '../domain/table/TableName';
import type { ViewId } from '../domain/table/views/ViewId';
import { captureViewSnapshot } from '../domain/table/views/ViewSnapshot';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { ITableRepository } from '../ports/TableRepository';
import type { IViewOperationPlugin } from '../ports/ViewOperationPlugin';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { UpdateViewColumnMetaCommand } from './UpdateViewColumnMetaCommand';
import { UpdateViewColumnMetaHandler } from './UpdateViewColumnMetaHandler';

const context: IExecutionContext = { actorId: ActorId.create('actor')._unsafeUnwrap() };

const buildTable = () => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'e'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Column metadata')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Primary')._unsafeUnwrap())
    .primary()
    .done();
  builder.field().singleLineText().withName(FieldName.create('Secondary')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  const baseTable = builder.build()._unsafeUnwrap();
  const [primaryField, secondaryField] = baseTable.getFields();
  const created = baseTable
    .createView({
      type: 'grid',
      name: 'Frozen',
      columnMeta: {
        [primaryField!.id().toString()]: { order: 0 },
        [secondaryField!.id().toString()]: { order: 1 },
      },
      options: { frozenFieldId: secondaryField!.id().toString() },
    })
    ._unsafeUnwrap();
  const table = created.updateResult.table;
  table.pullDomainEvents();
  return {
    table,
    viewId: created.view.id(),
    primaryFieldId: primaryField!.id(),
    secondaryFieldId: secondaryField!.id(),
  };
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
  const capture = vi.fn((table: Table, viewId: string) =>
    table.getViewById(viewId).andThen(captureViewSnapshot)
  );
  const appendUpdate = vi.fn(async () =>
    params.undoFailure ? err(params.undoFailure) : ok(undefined)
  );
  const handler = new UpdateViewColumnMetaHandler(
    repository,
    flow as unknown as TableUpdateFlow,
    new ViewOperationPluginRunner(params.plugins),
    { capture, appendUpdate } as unknown as ViewUndoRedoService
  );
  return { handler, repository, flow, capture, appendUpdate };
};

const commandFor = (
  table: Table,
  viewId: ViewId,
  fieldId: string,
  columnMeta: Record<string, unknown>
) =>
  UpdateViewColumnMetaCommand.create({
    tableId: table.id().toString(),
    viewId: viewId.toString(),
    columnMeta: [{ fieldId, columnMeta }],
  })._unsafeUnwrap();

describe('UpdateViewColumnMetaCommand', () => {
  it('validates aggregate, child, Field IDs, and strict metadata patches', () => {
    const fixture = buildTable();
    expect(
      commandFor(fixture.table, fixture.viewId, fixture.secondaryFieldId.toString(), { width: 240 })
    ).toBeInstanceOf(UpdateViewColumnMetaCommand);
    expect(
      UpdateViewColumnMetaCommand.create({
        tableId: fixture.table.id().toString(),
        viewId: fixture.viewId.toString(),
        columnMeta: [{ fieldId: 'bad', columnMeta: {} }],
      }).isErr()
    ).toBe(true);
    expect(
      UpdateViewColumnMetaCommand.create({
        tableId: fixture.table.id().toString(),
        viewId: fixture.viewId.toString(),
        columnMeta: [
          { fieldId: fixture.secondaryFieldId.toString(), columnMeta: { unsupported: true } },
        ],
      }).isErr()
    ).toBe(true);
  });
});

describe('UpdateViewColumnMetaHandler', () => {
  it('updates column metadata and frozen options through Table behavior, plugins, events, and undo', async () => {
    const fixture = buildTable();
    const prepare = vi.fn(() => ok(undefined));
    const setup = createHandler({
      tableResult: ok(fixture.table),
      plugins: [
        {
          name: 'capture',
          supports: (kind) => kind === ViewOperationKind.update,
          prepare,
          guard: () => ok(undefined),
        },
      ],
    });
    const command = commandFor(fixture.table, fixture.viewId, fixture.secondaryFieldId.toString(), {
      order: 2,
      width: 240,
    });

    const result = (await setup.handler.handle(context, command))._unsafeUnwrap();
    const view = result.table.getView(fixture.viewId)._unsafeUnwrap();

    expect(setup.repository.findOne).toHaveBeenCalledOnce();
    expect(setup.flow.mutateSpec).toBeInstanceOf(TableUpdateViewColumnMetaSpec);
    expect(result.changes).toHaveLength(1);
    expect(result.nextColumnMeta.toDto()[fixture.secondaryFieldId.toString()]).toMatchObject({
      order: 2,
      width: 240,
    });
    expect(result.previousOptions).toEqual({
      frozenFieldId: fixture.secondaryFieldId.toString(),
    });
    expect(result.nextOptions).toEqual({ frozenFieldId: fixture.primaryFieldId.toString() });
    expect(view.options()).toEqual({ frozenFieldId: fixture.primaryFieldId.toString() });
    expect(result.events.some((event) => event instanceof ViewColumnMetaUpdated)).toBe(true);
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: ViewOperationKind.update,
        payload: {
          tableId: fixture.table.id().toString(),
          viewId: fixture.viewId.toString(),
          patch: {
            columnMeta: result.nextColumnMeta.toDto(),
            options: { frozenFieldId: fixture.primaryFieldId.toString() },
          },
        },
      })
    );
    expect(setup.capture).toHaveBeenCalledTimes(2);
    expect(setup.appendUpdate).toHaveBeenCalledWith(
      context,
      result.table,
      [expect.objectContaining({ id: fixture.viewId.toString() })],
      [expect.objectContaining({ id: fixture.viewId.toString() })]
    );
  });

  it('returns a no-op without plugins, persistence, or a second undo snapshot', async () => {
    const fixture = buildTable();
    const prepare = vi.fn(() => ok(undefined));
    const setup = createHandler({
      tableResult: ok(fixture.table),
      plugins: [{ name: 'capture', supports: () => true, prepare }],
    });
    const command = UpdateViewColumnMetaCommand.create({
      tableId: fixture.table.id().toString(),
      viewId: fixture.viewId.toString(),
      columnMeta: [],
    })._unsafeUnwrap();

    const result = (await setup.handler.handle(context, command))._unsafeUnwrap();

    expect(result.table).toBe(fixture.table);
    expect(result.changes).toEqual([]);
    expect(result.events).toEqual([]);
    expect(prepare).not.toHaveBeenCalled();
    expect(setup.flow.calls).toBe(0);
    expect(setup.capture).toHaveBeenCalledOnce();
    expect(setup.appendUpdate).not.toHaveBeenCalled();
  });

  it('returns aggregate validation/not-found errors before plugins or persistence', async () => {
    const fixture = buildTable();
    const prepare = vi.fn(() => ok(undefined));
    const setup = createHandler({
      tableResult: ok(fixture.table),
      plugins: [{ name: 'capture', supports: () => true, prepare }],
    });
    const hidePrimary = commandFor(
      fixture.table,
      fixture.viewId,
      fixture.primaryFieldId.toString(),
      { hidden: true }
    );

    expect((await setup.handler.handle(context, hidePrimary))._unsafeUnwrapErr().code).toBe(
      'view.primary_field_cannot_be_hidden'
    );

    const missingField = commandFor(fixture.table, fixture.viewId, `fld${'z'.repeat(16)}`, {
      width: 100,
    });
    expect((await setup.handler.handle(context, missingField))._unsafeUnwrapErr().code).toBe(
      'field.not_found'
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(setup.flow.calls).toBe(0);
    expect(setup.appendUpdate).not.toHaveBeenCalled();
  });

  it('does not persist or append undo when plugin policy rejects the update', async () => {
    const fixture = buildTable();
    const setup = createHandler({
      tableResult: ok(fixture.table),
      plugins: [
        {
          name: 'reject',
          supports: () => true,
          guard: () => err(domainError.forbidden({ message: 'Metadata rejected' })),
        },
      ],
    });
    const command = commandFor(fixture.table, fixture.viewId, fixture.secondaryFieldId.toString(), {
      width: 300,
    });

    expect((await setup.handler.handle(context, command))._unsafeUnwrapErr().code).toBe(
      'forbidden'
    );
    expect(setup.flow.calls).toBe(0);
    expect(setup.capture).toHaveBeenCalledOnce();
    expect(setup.appendUpdate).not.toHaveBeenCalled();
  });

  it('propagates repository and undo failures at their orchestration boundaries', async () => {
    const fixture = buildTable();
    const command = commandFor(fixture.table, fixture.viewId, fixture.secondaryFieldId.toString(), {
      width: 320,
    });
    const missing = createHandler({
      tableResult: err(domainError.notFound({ message: 'Missing Table' })),
    });
    expect((await missing.handler.handle(context, command))._unsafeUnwrapErr().code).toBe(
      'not_found'
    );
    expect(missing.capture).not.toHaveBeenCalled();
    expect(missing.flow.calls).toBe(0);

    const undoRejected = createHandler({
      tableResult: ok(fixture.table),
      undoFailure: domainError.unexpected({ message: 'Undo store unavailable' }),
    });
    expect((await undoRejected.handler.handle(context, command))._unsafeUnwrapErr().code).toBe(
      'unexpected'
    );
    expect(undoRejected.flow.calls).toBe(1);
    expect(undoRejected.capture).toHaveBeenCalledTimes(2);
    expect(undoRejected.appendUpdate).toHaveBeenCalledOnce();
  });
});
