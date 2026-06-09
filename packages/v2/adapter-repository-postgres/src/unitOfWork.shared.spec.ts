import type { IExecutionContext, IUnitOfWorkTransaction } from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Transaction } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import { getPostgresTransaction, PostgresUnitOfWork } from '@teable/v2-adapter-db-postgres-shared';

const createContext = (transaction?: IUnitOfWorkTransaction): IExecutionContext => ({
  actorId: 'usrTest' as never,
  ...(transaction ? { transaction } : {}),
});

describe('shared Postgres unit of work helpers', () => {
  it('recognizes transaction-like objects from another package instance', () => {
    const db = { marker: 'data' } as unknown as Transaction<unknown>;
    const transaction = {
      kind: 'unitOfWorkTransaction',
      scope: 'data',
      db,
    } as IUnitOfWorkTransaction & { db: Transaction<unknown> };

    expect(getPostgresTransaction(createContext(transaction))).toBe(db);
  });

  it('reuses a sibling scope transaction when meta and data share the same physical database', async () => {
    const db = { marker: 'shared' } as unknown as Transaction<unknown>;
    const transaction = {
      kind: 'unitOfWorkTransaction',
      scope: 'data',
      db,
    } as IUnitOfWorkTransaction & { db: Transaction<unknown> };
    const metaDb = {
      transaction: vi.fn(),
    };
    const unitOfWork = new PostgresUnitOfWork(
      metaDb as never,
      {} as never,
      { pg: { connectionString: 'postgresql://local/teable' } },
      { pg: { connectionString: 'postgresql://local/teable' } }
    );

    let observedContext: IExecutionContext | undefined;
    const result = await unitOfWork.withTransaction(
      {
        ...createContext(transaction),
        transactions: { data: transaction },
      },
      async (transactionContext) => {
        observedContext = transactionContext;
        return ok('done');
      },
      { scope: 'meta' }
    );

    expect(result.isOk()).toBe(true);
    expect(metaDb.transaction).not.toHaveBeenCalled();
    expect(observedContext?.transaction).toBe(transaction);
    expect(observedContext?.transactions?.meta).toBe(transaction);
    expect(getPostgresTransaction(observedContext, 'meta')).toBe(db);
  });
});
