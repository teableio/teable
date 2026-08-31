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
import { TableUpdateViewDescriptionSpec } from '../domain/table/specs/TableUpdateViewDescriptionSpec';
import { Table } from '../domain/table/Table';
import type { TableUpdateResult } from '../domain/table/TableMutator';
import { TableName } from '../domain/table/TableName';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { ITableRepository } from '../ports/TableRepository';
import type { IViewOperationPlugin } from '../ports/ViewOperationPlugin';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { UpdateViewDescriptionCommand } from './UpdateViewDescriptionCommand';
import { UpdateViewDescriptionHandler } from './UpdateViewDescriptionHandler';

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
  const handler = new UpdateViewDescriptionHandler(
    tableRepository,
    tableUpdateFlow as unknown as TableUpdateFlow,
    pluginRunner,
    undoRedo
  );
  return { handler, tableRepository, tableUpdateFlow };
};

describe('UpdateViewDescriptionCommand', () => {
  it('validates Table and View identifiers and requires a string description', () => {
    expect(
      UpdateViewDescriptionCommand.create({
        tableId: 'bad',
        viewId: 'bad',
        description: 1,
      }).isErr()
    ).toBe(true);
  });
});

describe('UpdateViewDescriptionHandler', () => {
  it('orchestrates the Table aggregate, update guard, and description spec', async () => {
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
    const command = UpdateViewDescriptionCommand.create({
      tableId: table.id().toString(),
      viewId: target.id().toString(),
      description: 'After',
    })._unsafeUnwrap();

    const result = await setup.handler.handle(context, command);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().previousDescription).toBeUndefined();
    expect(result._unsafeUnwrap().nextDescription).toBe('After');
    expect(result._unsafeUnwrap().table.getView(target.id())._unsafeUnwrap().description()).toBe(
      'After'
    );
    expect(setup.tableRepository.findOne).toHaveBeenCalledOnce();
    expect(setup.tableUpdateFlow.calls).toBe(1);
    expect(setup.tableUpdateFlow.mutateSpec).toBeInstanceOf(TableUpdateViewDescriptionSpec);
    expect(seenOperations).toEqual([
      expect.objectContaining({
        kind: 'update',
        payload: {
          tableId: table.id().toString(),
          viewId: target.id().toString(),
          patch: { description: 'After' },
        },
      }),
    ]);
  });

  it('does not persist when the update operation guard rejects the request', async () => {
    const table = buildTable();
    const operationPlugin: IViewOperationPlugin = {
      name: 'reject',
      supports: (kind) => kind === ViewOperationKind.update,
      guard: () => err(domainError.forbidden({ message: 'View update rejected' })),
    };
    const setup = createHandler(table, [operationPlugin]);
    const command = UpdateViewDescriptionCommand.create({
      tableId: table.id().toString(),
      viewId: table.views()[0]!.id().toString(),
      description: 'Rejected',
    })._unsafeUnwrap();

    const result = await setup.handler.handle(context, command);

    expect(result._unsafeUnwrapErr().code).toBe('forbidden');
    expect(setup.tableUpdateFlow.calls).toBe(0);
  });

  it('returns an aggregate error and skips persistence for a missing View', async () => {
    const table = buildTable();
    const setup = createHandler(table);
    const command = UpdateViewDescriptionCommand.create({
      tableId: table.id().toString(),
      viewId: `viw${'z'.repeat(16)}`,
      description: 'Missing',
    })._unsafeUnwrap();

    const result = await setup.handler.handle(context, command);

    expect(result._unsafeUnwrapErr().code).toBe('view.not_found');
    expect(setup.tableUpdateFlow.calls).toBe(0);
  });
});
