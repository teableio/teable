import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { ActorId } from '../../domain/shared/ActorId';
import type { DomainError } from '../../domain/shared/DomainError';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type {
  ITableRepository,
  TableProvisionOperationOptions,
  TableProvisionState,
} from '../../ports/TableRepository';
import type { IUnitOfWork, IUnitOfWorkOptions, UnitOfWorkOperation } from '../../ports/UnitOfWork';
import {
  beginTableSchemaOperation,
  beginTablesSchemaOperation,
  completeTableSchemaOperation,
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

describe('TableSchemaOperationLifecycleService', () => {
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
