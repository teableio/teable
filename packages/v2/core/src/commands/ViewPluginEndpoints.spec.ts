import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError } from '../domain/shared/DomainError';
import { FieldName } from '../domain/table/fields/FieldName';
import { Table } from '../domain/table/Table';
import { TableName } from '../domain/table/TableName';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { ITableRepository } from '../ports/TableRepository';
import type { IUnitOfWork } from '../ports/UnitOfWork';
import type { IViewPluginRepository } from '../ports/ViewPluginRepository';
import { GetViewPluginInstallHandler } from '../queries/GetViewPluginInstallHandler';
import { GetViewPluginInstallQuery } from '../queries/GetViewPluginInstallQuery';
import { UpdateViewPluginStorageCommand } from './UpdateViewPluginStorageCommand';
import { UpdateViewPluginStorageHandler } from './UpdateViewPluginStorageHandler';

const context: IExecutionContext = {
  actorId: ActorId.create('actor')._unsafeUnwrap(),
};

const buildTable = () => {
  const table = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Plugin endpoints')._unsafeUnwrap())
    .field()
    .singleLineText()
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .done()
    .view()
    .defaultGrid()
    .done()
    .build()
    ._unsafeUnwrap();
  return table
    .createView({
      type: 'plugin',
      name: 'Sheet',
      options: {
        pluginId: 'plg-sheet',
        pluginInstallId: 'pli-sheet',
        pluginLogo: 'logo.svg',
      },
    })
    ._unsafeUnwrap().updateResult.table;
};

const buildPluginRepository = (): IViewPluginRepository => ({
  findViewPlugin: vi.fn(async () => ok({ id: 'plg-sheet', name: 'Sheet', logo: 'logo.svg' })),
  insertViewPluginInstallation: vi.fn(async () => ok(undefined)),
  findViewPluginInstallationByViewId: vi.fn(async () => ok({ storage: null })),
  getViewPluginInstallation: vi.fn(async (_context, baseId, viewId) =>
    ok({
      id: 'pli-sheet',
      pluginId: 'plg-sheet',
      baseId,
      viewId,
      name: 'Sheet',
      url: '/plugin/sheet',
      storage: { loaded: true },
    })
  ),
  updateViewPluginStorage: vi.fn(async () => ok(undefined)),
});

describe('Plugin View query and storage command', () => {
  let table: ReturnType<typeof buildTable>;
  let tableRepository: ITableRepository;
  let pluginRepository: IViewPluginRepository;
  let unitOfWork: IUnitOfWork;
  let viewId: string;

  beforeEach(() => {
    table = buildTable();
    viewId = table
      .views()
      .find((view) => view.type().toString() === 'plugin')!
      .id()
      .toString();
    tableRepository = {
      findOne: vi.fn(async () => ok(table)),
    } as unknown as ITableRepository;
    pluginRepository = buildPluginRepository();
    unitOfWork = {
      withTransaction: vi.fn(async (currentContext, work) => work(currentContext)),
    };
  });

  it('loads the Table aggregate with its target View before reading the installation', async () => {
    const handler = new GetViewPluginInstallHandler(tableRepository, pluginRepository);
    const query = GetViewPluginInstallQuery.create({
      tableId: table.id().toString(),
      viewId,
    })._unsafeUnwrap();

    const result = await handler.handle(context, query);

    expect(result._unsafeUnwrap().installation).toMatchObject({
      id: 'pli-sheet',
      baseId: table.baseId().toString(),
      viewId,
      storage: { loaded: true },
    });
    expect(pluginRepository.getViewPluginInstallation).toHaveBeenCalledWith(
      context,
      table.baseId().toString(),
      viewId
    );
  });

  it('rejects a View outside the loaded Table before querying PluginInstallation', async () => {
    const handler = new GetViewPluginInstallHandler(tableRepository, pluginRepository);
    const query = GetViewPluginInstallQuery.create({
      tableId: table.id().toString(),
      viewId: `viw${'z'.repeat(16)}`,
    })._unsafeUnwrap();

    const result = await handler.handle(context, query);

    expect(result._unsafeUnwrapErr().code).toBe('view.not_found');
    expect(pluginRepository.getViewPluginInstallation).not.toHaveBeenCalled();
  });

  it('updates storage only after the Table aggregate confirms View ownership', async () => {
    const handler = new UpdateViewPluginStorageHandler(
      tableRepository,
      pluginRepository,
      unitOfWork
    );
    const storage = { nested: { rows: [1, true, 'value'] } };
    const command = UpdateViewPluginStorageCommand.create({
      tableId: table.id().toString(),
      viewId,
      pluginInstallId: 'pli-sheet',
      storage,
    })._unsafeUnwrap();

    const result = await handler.handle(context, command);

    expect(result._unsafeUnwrap()).toMatchObject({
      tableId: table.id().toString(),
      viewId,
      pluginInstallId: 'pli-sheet',
      storage,
    });
    expect(pluginRepository.updateViewPluginStorage).toHaveBeenCalledWith(context, {
      baseId: table.baseId().toString(),
      viewId,
      pluginInstallId: 'pli-sheet',
      storage,
    });
    expect(unitOfWork.withTransaction).toHaveBeenCalledWith(context, expect.any(Function), {
      scope: 'meta',
    });
    expect(tableRepository.findOne).toHaveBeenCalledWith(context, expect.anything(), {
      lock: 'forUpdate',
    });
  });

  it('propagates installation mismatch and does not mutate the Table', async () => {
    vi.mocked(pluginRepository.updateViewPluginStorage).mockResolvedValue(
      err(domainError.notFound({ message: 'Plugin installation not found' }))
    );
    const handler = new UpdateViewPluginStorageHandler(
      tableRepository,
      pluginRepository,
      unitOfWork
    );
    const command = UpdateViewPluginStorageCommand.create({
      tableId: table.id().toString(),
      viewId,
      pluginInstallId: 'pli-other',
      storage: { rejected: true },
    })._unsafeUnwrap();

    const result = await handler.handle(context, command);

    expect(result._unsafeUnwrapErr().code).toBe('not_found');
    expect(table.getView(command.viewId).isOk()).toBe(true);
  });

  it('validates storage as a record at the command boundary', () => {
    expect(
      UpdateViewPluginStorageCommand.create({
        tableId: table.id().toString(),
        viewId,
        pluginInstallId: 'pli-sheet',
        storage: ['invalid'],
      })._unsafeUnwrapErr().code
    ).toBe('validation.invalid');
  });
});
