import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldName } from '../domain/table/fields/FieldName';
import { Table } from '../domain/table/Table';
import { TableName } from '../domain/table/TableName';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { ITableRepository } from '../ports/TableRepository';
import type { IUnitOfWork } from '../ports/UnitOfWork';
import type { IViewPluginRepository } from '../ports/ViewPluginRepository';
import { UpdateViewPluginStorageCommand } from './UpdateViewPluginStorageCommand';
import { UpdateViewPluginStorageHandler } from './UpdateViewPluginStorageHandler';

const context: IExecutionContext = { actorId: ActorId.create('actor')._unsafeUnwrap() };
const transactionContext: IExecutionContext = {
  actorId: ActorId.create('transaction')._unsafeUnwrap(),
};

const buildTable = () => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'g'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Plugin storage')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  const created = builder
    .build()
    ._unsafeUnwrap()
    .createView({
      type: 'plugin',
      name: 'Sheet',
      options: {
        pluginId: 'plg-sheet',
        pluginInstallId: 'pli-sheet',
        pluginLogo: 'logo.svg',
      },
    })
    ._unsafeUnwrap();
  const table = created.updateResult.table;
  table.pullDomainEvents();
  return { table, viewId: created.view.id() };
};

const buildPluginRepository = (): IViewPluginRepository => ({
  findViewPlugin: vi.fn(async () => err(domainError.notFound({ message: 'Not used' }))),
  insertViewPluginInstallation: vi.fn(async () =>
    err(domainError.notFound({ message: 'Not used' }))
  ),
  findViewPluginInstallationByViewId: vi.fn(async () =>
    err(domainError.notFound({ message: 'Not used' }))
  ),
  getViewPluginInstallation: vi.fn(async () => err(domainError.notFound({ message: 'Not used' }))),
  updateViewPluginStorage: vi.fn(async () => ok(undefined)),
});

class FakeUnitOfWork implements IUnitOfWork {
  calls = 0;
  options?: { scope?: 'meta' | 'data' };

  constructor(private readonly failure?: DomainError) {}

  async withTransaction<T>(
    _context: IExecutionContext,
    work: (context: IExecutionContext) => Promise<Result<T, DomainError>>,
    options?: { scope?: 'meta' | 'data' }
  ): Promise<Result<T, DomainError>> {
    this.calls += 1;
    this.options = options;
    if (this.failure) return err(this.failure);
    return work(transactionContext);
  }
}

const createHandler = (params: {
  tableResult: Result<Table, DomainError>;
  pluginRepository?: IViewPluginRepository;
  transactionFailure?: DomainError;
}) => {
  const tableRepository = {
    findOne: vi.fn(async () => params.tableResult),
  } as unknown as ITableRepository;
  const pluginRepository = params.pluginRepository ?? buildPluginRepository();
  const unitOfWork = new FakeUnitOfWork(params.transactionFailure);
  const handler = new UpdateViewPluginStorageHandler(tableRepository, pluginRepository, unitOfWork);
  return { handler, tableRepository, pluginRepository, unitOfWork };
};

describe('UpdateViewPluginStorageCommand', () => {
  it('validates identifiers, installation ID, and record-shaped storage', () => {
    const fixture = buildTable();
    expect(
      UpdateViewPluginStorageCommand.create({
        tableId: fixture.table.id().toString(),
        viewId: fixture.viewId.toString(),
        pluginInstallId: 'pli-sheet',
        storage: { valid: true },
      }).isOk()
    ).toBe(true);
    expect(
      UpdateViewPluginStorageCommand.create({
        tableId: fixture.table.id().toString(),
        viewId: fixture.viewId.toString(),
        pluginInstallId: '',
      }).isErr()
    ).toBe(true);
    expect(
      UpdateViewPluginStorageCommand.create({
        tableId: fixture.table.id().toString(),
        viewId: fixture.viewId.toString(),
        pluginInstallId: 'pli-sheet',
        storage: [],
      }).isErr()
    ).toBe(true);
  });
});

describe('UpdateViewPluginStorageHandler', () => {
  it('locks the Table aggregate and updates the independent installation in one meta transaction', async () => {
    const fixture = buildTable();
    const pluginRepository = buildPluginRepository();
    const setup = createHandler({
      tableResult: ok(fixture.table),
      pluginRepository,
    });
    const storage = { nested: { values: [1, true, 'value'] } };
    const command = UpdateViewPluginStorageCommand.create({
      tableId: fixture.table.id().toString(),
      viewId: fixture.viewId.toString(),
      pluginInstallId: 'pli-sheet',
      storage,
    })._unsafeUnwrap();

    const result = (await setup.handler.handle(context, command))._unsafeUnwrap();

    expect(result).toMatchObject({
      tableId: fixture.table.id().toString(),
      viewId: fixture.viewId.toString(),
      pluginInstallId: 'pli-sheet',
      storage,
    });
    expect(setup.unitOfWork.calls).toBe(1);
    expect(setup.unitOfWork.options).toEqual({ scope: 'meta' });
    expect(setup.tableRepository.findOne).toHaveBeenCalledWith(
      transactionContext,
      expect.anything(),
      { lock: 'forUpdate' }
    );
    expect(pluginRepository.updateViewPluginStorage).toHaveBeenCalledWith(transactionContext, {
      baseId: fixture.table.baseId().toString(),
      viewId: fixture.viewId.toString(),
      pluginInstallId: 'pli-sheet',
      storage,
    });
  });

  it('maps a repository not-found to view.not_found before touching PluginInstallation', async () => {
    const fixture = buildTable();
    const setup = createHandler({
      tableResult: err(domainError.notFound({ message: 'Filtered Table/View not found' })),
    });
    const command = UpdateViewPluginStorageCommand.create({
      tableId: fixture.table.id().toString(),
      viewId: fixture.viewId.toString(),
      pluginInstallId: 'pli-sheet',
    })._unsafeUnwrap();

    const result = await setup.handler.handle(context, command);

    expect(result._unsafeUnwrapErr().code).toBe('view.not_found');
    expect(setup.pluginRepository.updateViewPluginStorage).not.toHaveBeenCalled();
  });

  it('rechecks aggregate membership when a stale repository result omits the requested View', async () => {
    const fixture = buildTable();
    const missingViewId = `viw${'z'.repeat(16)}`;
    const setup = createHandler({ tableResult: ok(fixture.table) });
    const command = UpdateViewPluginStorageCommand.create({
      tableId: fixture.table.id().toString(),
      viewId: missingViewId,
      pluginInstallId: 'pli-sheet',
      storage: { rejected: true },
    })._unsafeUnwrap();

    const result = await setup.handler.handle(context, command);

    expect(result._unsafeUnwrapErr().code).toBe('view.not_found');
    expect(setup.pluginRepository.updateViewPluginStorage).not.toHaveBeenCalled();
  });

  it('propagates non-not-found repository and PluginInstallation failures', async () => {
    const fixture = buildTable();
    const repositoryFailure = createHandler({
      tableResult: err(domainError.unexpected({ message: 'Database unavailable' })),
    });
    const command = UpdateViewPluginStorageCommand.create({
      tableId: fixture.table.id().toString(),
      viewId: fixture.viewId.toString(),
      pluginInstallId: 'pli-sheet',
      storage: { value: 1 },
    })._unsafeUnwrap();

    expect((await repositoryFailure.handler.handle(context, command))._unsafeUnwrapErr().code).toBe(
      'unexpected'
    );

    const pluginRepository = buildPluginRepository();
    vi.mocked(pluginRepository.updateViewPluginStorage).mockResolvedValue(
      err(domainError.notFound({ message: 'Installation mismatch' }))
    );
    const installationFailure = createHandler({
      tableResult: ok(fixture.table),
      pluginRepository,
    });
    expect(
      (await installationFailure.handler.handle(context, command))._unsafeUnwrapErr().code
    ).toBe('not_found');
  });

  it('does not query the aggregate when the meta transaction cannot start', async () => {
    const fixture = buildTable();
    const setup = createHandler({
      tableResult: ok(fixture.table),
      transactionFailure: domainError.unexpected({ message: 'Transaction unavailable' }),
    });
    const command = UpdateViewPluginStorageCommand.create({
      tableId: fixture.table.id().toString(),
      viewId: fixture.viewId.toString(),
      pluginInstallId: 'pli-sheet',
    })._unsafeUnwrap();

    expect((await setup.handler.handle(context, command))._unsafeUnwrapErr().code).toBe(
      'unexpected'
    );
    expect(setup.tableRepository.findOne).not.toHaveBeenCalled();
    expect(setup.pluginRepository.updateViewPluginStorage).not.toHaveBeenCalled();
  });
});
