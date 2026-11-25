import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { ActorId } from '../../domain/shared/ActorId';
import type { DomainError } from '../../domain/shared/DomainError';
import type { Table } from '../../domain/table/Table';
import type {
  IExecutionContext,
  IUnitOfWorkTransaction,
  UnitOfWorkAfterCommitHandler,
} from '../../ports/ExecutionContext';
import type {
  ITableRepository,
  TableProvisionOperationOptions,
  TableProvisionState,
} from '../../ports/TableRepository';
import type { IUnitOfWork, IUnitOfWorkOptions, UnitOfWorkOperation } from '../../ports/UnitOfWork';
import {
  abandonTableSchemaOperation,
  beginTableSchemaOperation,
  beginTablesSchemaOperation,
  completeTableSchemaOperation,
  completeTablesSchemaOperation,
  failRecoverableTableSchemaOperation,
  failTableSchemaOperation,
} from './TableSchemaOperationLifecycleService';

const context = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

const table = (id: string): Table =>
  ({
    id: () => ({ toString: () => id }),
  }) as unknown as Table;

class FakeUnitOfWork implements IUnitOfWork {
  readonly scopes: Array<IUnitOfWorkOptions['scope']> = [];

  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>,
    options?: IUnitOfWorkOptions
  ): Promise<Result<T, DomainError>> {
    this.scopes.push(options?.scope);
    return work(context);
  }
}

const repository = (): ITableRepository =>
  ({
    setProvisionState: vi.fn(
      async (
        _: IExecutionContext,
        __: Table,
        ___: TableProvisionState,
        ____?: TableProvisionOperationOptions
      ) => ok(undefined)
    ),
    setProvisionStateMany: vi.fn(
      async (
        _: IExecutionContext,
        __: ReadonlyArray<Table>,
        ___: TableProvisionState,
        ____?: TableProvisionOperationOptions
      ) => ok(undefined)
    ),
  }) as unknown as ITableRepository;

const transactionControl = (scope: 'data' | 'meta') => {
  const hooks: UnitOfWorkAfterCommitHandler[] = [];
  let committed = false;
  let rolledBack = false;
  const transaction: IUnitOfWorkTransaction = {
    kind: 'unitOfWorkTransaction',
    scope,
    get pending() {
      return !committed && !rolledBack;
    },
    get committed() {
      return committed;
    },
    get rolledBack() {
      return rolledBack;
    },
    afterCommit: (hook) => hooks.push(hook),
  };
  return {
    transaction,
    async commit() {
      committed = true;
      for (const hook of hooks) await hook();
    },
    rollback() {
      rolledBack = true;
    },
  };
};

describe('TableSchemaOperationLifecycleService', () => {
  it('waits for ambient data commit before publishing storage capability', async () => {
    const unitOfWork = new FakeUnitOfWork();
    const tableRepository = repository();
    const data = transactionControl('data');
    const executionContext = { ...context(), transaction: data.transaction };

    const result = await completeTableSchemaOperation(
      unitOfWork,
      tableRepository,
      executionContext,
      table('tblLifecycle00000D'),
      { type: 'table.create', publishActorStorageVersion: 1 }
    );

    expect(result.isOk()).toBe(true);
    expect(tableRepository.setProvisionState).not.toHaveBeenCalled();
    await data.commit();
    expect(tableRepository.setProvisionState).toHaveBeenCalledOnce();
    const publicationContext = vi.mocked(tableRepository.setProvisionState!).mock.calls[0]![0];
    expect(publicationContext.transaction).toBeUndefined();
    expect(publicationContext.transactions).toBeUndefined();
  });

  it('requires both independent metadata and data commits for multi-table publication', async () => {
    const unitOfWork = new FakeUnitOfWork();
    const tableRepository = repository();
    const data = transactionControl('data');
    const meta = transactionControl('meta');
    const executionContext = {
      ...context(),
      transaction: data.transaction,
      transactions: { data: data.transaction, meta: meta.transaction },
    };

    (
      await completeTablesSchemaOperation(
        unitOfWork,
        tableRepository,
        executionContext,
        [table('tblLifecycle00000M')],
        { type: 'table.create_many', publishActorStorageVersion: 1 }
      )
    )._unsafeUnwrap();
    await data.commit();
    expect(tableRepository.setProvisionStateMany).not.toHaveBeenCalled();
    await meta.commit();
    expect(tableRepository.setProvisionStateMany).toHaveBeenCalledOnce();
  });

  it('does not publish after an ambient rollback or without a commit hook', async () => {
    const unitOfWork = new FakeUnitOfWork();
    const tableRepository = repository();
    const data = transactionControl('data');
    (
      await completeTableSchemaOperation(
        unitOfWork,
        tableRepository,
        { ...context(), transaction: data.transaction },
        table('tblLifecycle00000R'),
        { type: 'table.create', publishActorStorageVersion: 1 }
      )
    )._unsafeUnwrap();
    data.rollback();
    expect(tableRepository.setProvisionState).not.toHaveBeenCalled();

    const result = await completeTableSchemaOperation(
      unitOfWork,
      tableRepository,
      {
        ...context(),
        transaction: { kind: 'unitOfWorkTransaction', scope: 'data', pending: true },
      },
      table('tblLifecycle00000N'),
      { type: 'table.create', publishActorStorageVersion: 1 }
    );
    expect(result._unsafeUnwrapErr().code).toBe(
      'actor_storage.publication_transaction_owner_required'
    );
    expect(tableRepository.setProvisionState).not.toHaveBeenCalled();
  });

  it('begins a table operation with a canonical pending phase and table payload', async () => {
    const unitOfWork = new FakeUnitOfWork();
    const tableRepository = repository();
    const targetTable = table('tblLifecycle000001');

    const result = await beginTableSchemaOperation(
      unitOfWork,
      tableRepository,
      context(),
      targetTable,
      {
        type: 'table.import',
        payload: { source: 'csv' },
      }
    );

    expect(result.isOk()).toBe(true);
    expect(unitOfWork.scopes).toEqual(['meta']);
    expect(tableRepository.setProvisionState).toHaveBeenCalledWith(
      expect.any(Object),
      targetTable,
      'pending',
      expect.objectContaining({
        operationType: 'table.import',
        phase: 'metadata_pending',
        payload: {
          source: 'csv',
          tableId: 'tblLifecycle000001',
        },
      })
    );
  });

  it('marks ready and error without replacing the initial operation payload by default', async () => {
    const unitOfWork = new FakeUnitOfWork();
    const tableRepository = repository();
    const targetTable = table('tblLifecycle000002');

    await completeTableSchemaOperation(unitOfWork, tableRepository, context(), targetTable, {
      type: 'table.create',
    });
    await failTableSchemaOperation(unitOfWork, tableRepository, context(), targetTable, {
      type: 'table.create',
      lastError: 'data phase failed',
    });

    expect(tableRepository.setProvisionState).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      targetTable,
      'ready',
      expect.objectContaining({
        operationType: 'table.create',
        phase: 'ready',
        payload: undefined,
      })
    );
    expect(tableRepository.setProvisionState).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      targetTable,
      'error',
      expect.objectContaining({
        lastError: 'data phase failed',
        operationType: 'table.create',
        phase: 'error',
        payload: undefined,
      })
    );
  });

  it('forwards explicit post-create publication without inferring it from ready state', async () => {
    const unitOfWork = new FakeUnitOfWork();
    const tableRepository = repository();
    const targetTable = table('tblLifecycle00000P');

    await completeTableSchemaOperation(unitOfWork, tableRepository, context(), targetTable, {
      type: 'table.create',
    });
    await completeTableSchemaOperation(unitOfWork, tableRepository, context(), targetTable, {
      type: 'table.create',
      publishActorStorageVersion: 1,
    });

    expect(tableRepository.setProvisionState).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      targetTable,
      'ready',
      expect.objectContaining({ publishActorStorageVersion: undefined })
    );
    expect(tableRepository.setProvisionState).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      targetTable,
      'ready',
      expect.objectContaining({ publishActorStorageVersion: 1 })
    );
  });

  it('abandons a cleaned-up table operation as dead so the runner will not claim it', async () => {
    const unitOfWork = new FakeUnitOfWork();
    const tableRepository = repository();
    const targetTable = table('tblLifecycle00000A');

    const result = await abandonTableSchemaOperation(
      unitOfWork,
      tableRepository,
      context(),
      targetTable,
      {
        type: 'table.import',
        lastError: 'Exceed max row limit: 1',
        payload: { source: 'csv', durableSource: false },
      }
    );

    expect(result.isOk()).toBe(true);
    expect(tableRepository.setProvisionState).toHaveBeenCalledWith(
      expect.any(Object),
      targetTable,
      'error',
      expect.objectContaining({
        lastError: 'Exceed max row limit: 1',
        operationType: 'table.import',
        phase: 'error',
        status: 'dead',
        payload: {
          source: 'csv',
          durableSource: false,
          tableId: 'tblLifecycle00000A',
        },
      })
    );
  });

  it('records recoverable failures without marking the table unavailable', async () => {
    const unitOfWork = new FakeUnitOfWork();
    const tableRepository = repository();
    const targetTable = table('tblLifecycle00000R');

    const result = await failRecoverableTableSchemaOperation(
      unitOfWork,
      tableRepository,
      context(),
      targetTable,
      {
        type: 'table.update',
        lastError: 'record write failed after schema metadata stayed rollback-safe',
      }
    );

    expect(result.isOk()).toBe(true);
    expect(tableRepository.setProvisionState).toHaveBeenCalledWith(
      expect.any(Object),
      targetTable,
      'ready',
      expect.objectContaining({
        lastError: 'record write failed after schema metadata stayed rollback-safe',
        operationType: 'table.update',
        phase: 'error',
        status: 'error',
        payload: undefined,
      })
    );
  });

  it('begins a multi-table operation with table IDs added to the shared payload', async () => {
    const unitOfWork = new FakeUnitOfWork();
    const tableRepository = repository();
    const tables = [table('tblLifecycle000003'), table('tblLifecycle000004')];

    const result = await beginTablesSchemaOperation(
      unitOfWork,
      tableRepository,
      context(),
      tables,
      {
        type: 'table.create_many',
        payload: { baseId: 'bseLifecycle000001' },
      }
    );

    expect(result.isOk()).toBe(true);
    expect(tableRepository.setProvisionStateMany).toHaveBeenCalledWith(
      expect.any(Object),
      tables,
      'pending',
      expect.objectContaining({
        operationType: 'table.create_many',
        phase: 'metadata_pending',
        payload: {
          baseId: 'bseLifecycle000001',
          tableIds: ['tblLifecycle000003', 'tblLifecycle000004'],
        },
      })
    );
  });
});
