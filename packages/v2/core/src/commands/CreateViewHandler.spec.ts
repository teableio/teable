import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import { ViewPluginCreationService } from '../application/services/ViewPluginCreationService';
import type { ViewUndoRedoService } from '../application/services/ViewUndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { ViewCreated } from '../domain/table/events/ViewCreated';
import { FieldName } from '../domain/table/fields/FieldName';
import { TableAddViewSpec } from '../domain/table/specs/TableAddViewSpec';
import { Table } from '../domain/table/Table';
import type { TableUpdateResult } from '../domain/table/TableMutator';
import { TableName } from '../domain/table/TableName';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { ITableRepository } from '../ports/TableRepository';
import type { IViewOperationPlugin } from '../ports/ViewOperationPlugin';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import type { IViewPluginRepository } from '../ports/ViewPluginRepository';
import { CreateViewCommand } from './CreateViewCommand';
import { CreateViewHandler } from './CreateViewHandler';

const context: IExecutionContext = { actorId: ActorId.create('actor')._unsafeUnwrap() };
const transactionContext: IExecutionContext = {
  actorId: ActorId.create('transaction')._unsafeUnwrap(),
};

const buildTable = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'d'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Create View')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  table.pullDomainEvents();
  return table;
};

const buildPluginRepository = (): IViewPluginRepository => ({
  findViewPlugin: vi.fn(async () =>
    ok({
      id: 'plg-sheet',
      name: 'Plugin default',
      logo: 'https://example.test/logo.png',
    })
  ),
  insertViewPluginInstallation: vi.fn(async () => ok(undefined)),
  findViewPluginInstallationByViewId: vi.fn(async () =>
    err(domainError.notFound({ message: 'Not used' }))
  ),
  getViewPluginInstallation: vi.fn(async () => err(domainError.notFound({ message: 'Not used' }))),
  updateViewPluginStorage: vi.fn(async () => err(domainError.notFound({ message: 'Not used' }))),
});

class FakeTableUpdateFlow {
  calls = 0;
  mutateSpec?: TableUpdateResult['mutateSpec'];

  async execute(
    _context: IExecutionContext,
    target: { table: Table },
    mutate: (table: Table) => Result<TableUpdateResult, DomainError>,
    options?: {
      hooks?: {
        prepare?: (
          context: IExecutionContext,
          table: Table,
          spec: TableUpdateResult['mutateSpec']
        ) => Promise<Result<ReadonlyArray<IDomainEvent>, DomainError>>;
      };
    }
  ) {
    this.calls += 1;
    const result = mutate(target.table);
    if (result.isErr()) return err(result.error);
    this.mutateSpec = result.value.mutateSpec;
    if (options?.hooks?.prepare) {
      const hookResult = await options.hooks.prepare(
        transactionContext,
        result.value.table,
        result.value.mutateSpec
      );
      if (hookResult.isErr()) return err(hookResult.error);
    }
    return ok({
      table: result.value.table,
      events: result.value.table.pullDomainEvents(),
      postPersistEvents: [],
    });
  }
}

const createHandler = (params: {
  tableResult: Result<Table, DomainError>;
  pluginRepository?: IViewPluginRepository;
  operationPlugins?: IViewOperationPlugin[];
  undoFailure?: DomainError;
}) => {
  const repository = {
    findOne: vi.fn(async () => params.tableResult),
  } as unknown as ITableRepository;
  const flow = new FakeTableUpdateFlow();
  const pluginRepository = params.pluginRepository ?? buildPluginRepository();
  const capture = vi.fn((_table: Table, viewId: string) => ok({ id: viewId } as never));
  const appendCreate = vi.fn(async () =>
    params.undoFailure ? err(params.undoFailure) : ok(undefined)
  );
  const handler = new CreateViewHandler(
    repository,
    flow as unknown as TableUpdateFlow,
    new ViewOperationPluginRunner(params.operationPlugins),
    new ViewPluginCreationService(pluginRepository),
    { capture, appendCreate } as unknown as ViewUndoRedoService
  );
  return { handler, repository, flow, pluginRepository, capture, appendCreate };
};

describe('CreateViewCommand', () => {
  it('validates Table IDs, View types, and source filters', () => {
    const table = buildTable();
    expect(
      CreateViewCommand.create({
        tableId: table.id().toString(),
        view: { type: 'grid', name: 'Valid' },
      }).isOk()
    ).toBe(true);
    expect(CreateViewCommand.create({ tableId: 'bad', view: { type: 'grid' } }).isErr()).toBe(true);
    expect(
      CreateViewCommand.create({
        tableId: table.id().toString(),
        view: { type: 'unsupported' },
      }).isErr()
    ).toBe(true);
  });
});

describe('CreateViewHandler', () => {
  it('creates an ordinary View through Table behavior, plugin policy, persistence, events, and undo', async () => {
    const table = buildTable();
    const prepare = vi.fn(() => ok(undefined));
    const setup = createHandler({
      tableResult: ok(table),
      operationPlugins: [
        {
          name: 'capture',
          supports: (kind) => kind === ViewOperationKind.create,
          prepare,
          guard: () => ok(undefined),
        },
      ],
    });
    const command = CreateViewCommand.create({
      tableId: table.id().toString(),
      view: {
        type: 'gallery',
        name: 'Gallery',
        description: 'Created through the aggregate',
      },
    })._unsafeUnwrap();

    const result = (await setup.handler.handle(context, command))._unsafeUnwrap();
    const view = result.table.getView(result.viewId)._unsafeUnwrap();

    expect(setup.repository.findOne).toHaveBeenCalledOnce();
    expect(setup.flow.mutateSpec).toBeInstanceOf(TableAddViewSpec);
    expect(view.name().toString()).toBe('Gallery');
    expect(view.description()).toBe('Created through the aggregate');
    expect(result.events.some((event) => event instanceof ViewCreated)).toBe(true);
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: ViewOperationKind.create,
        payload: expect.objectContaining({
          tableId: table.id().toString(),
          currentViewCount: 1,
          addedViewCount: 1,
          view: expect.objectContaining({
            name: 'Gallery',
            description: 'Created through the aggregate',
          }),
        }),
      })
    );
    expect(setup.capture).toHaveBeenCalledWith(result.table, result.viewId.toString());
    expect(setup.appendCreate).toHaveBeenCalledWith(
      context,
      result.table,
      expect.objectContaining({ id: result.viewId.toString() })
    );
    expect(setup.pluginRepository.findViewPlugin).not.toHaveBeenCalled();
  });

  it('creates PluginInstallation in the Table persistence transaction for a Plugin View', async () => {
    const table = buildTable();
    const pluginRepository = buildPluginRepository();
    const setup = createHandler({ tableResult: ok(table), pluginRepository });
    const command = CreateViewCommand.create({
      tableId: table.id().toString(),
      view: {
        type: 'plugin',
        name: '',
        options: { pluginId: 'plg-sheet' },
      },
    })._unsafeUnwrap();

    const result = (await setup.handler.handle(context, command))._unsafeUnwrap();
    const view = result.table.getView(result.viewId)._unsafeUnwrap();
    const options = view.options() as {
      pluginId: string;
      pluginInstallId: string;
      pluginLogo: string;
    };

    expect(view.name().toString()).toBe('Plugin default');
    expect(options).toMatchObject({
      pluginId: 'plg-sheet',
      pluginLogo: 'https://example.test/logo.png',
    });
    expect(options.pluginInstallId).toMatch(/^pli[0-9a-zA-Z]{16}$/);
    expect(pluginRepository.insertViewPluginInstallation).toHaveBeenCalledWith(transactionContext, {
      id: options.pluginInstallId,
      pluginId: 'plg-sheet',
      baseId: table.baseId().toString(),
      viewId: result.viewId.toString(),
      name: 'Plugin default',
    });
  });

  it('stops before persistence and undo when plugin preparation or operation policy fails', async () => {
    const table = buildTable();
    const pluginRepository = buildPluginRepository();
    vi.mocked(pluginRepository.findViewPlugin).mockResolvedValue(
      err(domainError.notFound({ message: 'Plugin missing' }))
    );
    const missingPlugin = createHandler({ tableResult: ok(table), pluginRepository });
    const pluginCommand = CreateViewCommand.create({
      tableId: table.id().toString(),
      view: { type: 'plugin', options: { pluginId: 'missing' } },
    })._unsafeUnwrap();

    expect(
      (await missingPlugin.handler.handle(context, pluginCommand))._unsafeUnwrapErr().code
    ).toBe('not_found');
    expect(missingPlugin.flow.calls).toBe(0);
    expect(missingPlugin.appendCreate).not.toHaveBeenCalled();

    const rejected = createHandler({
      tableResult: ok(table),
      operationPlugins: [
        {
          name: 'reject',
          supports: () => true,
          guard: () => err(domainError.forbidden({ message: 'View limit reached' })),
        },
      ],
    });
    const gridCommand = CreateViewCommand.create({
      tableId: table.id().toString(),
      view: { type: 'grid', name: 'Rejected' },
    })._unsafeUnwrap();

    expect((await rejected.handler.handle(context, gridCommand))._unsafeUnwrapErr().code).toBe(
      'forbidden'
    );
    expect(rejected.flow.calls).toBe(0);
    expect(rejected.appendCreate).not.toHaveBeenCalled();
  });

  it('propagates repository and undo failures at their orchestration boundaries', async () => {
    const table = buildTable();
    const command = CreateViewCommand.create({
      tableId: table.id().toString(),
      view: { type: 'grid', name: 'View' },
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
    expect(undoRejected.appendCreate).toHaveBeenCalledOnce();
  });
});
