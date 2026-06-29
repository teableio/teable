import type { IExecutionContext, IUnitOfWorkTransaction } from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Transaction } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import {
  getPostgresTransaction,
  PostgresUnitOfWork,
  PostgresUnitOfWorkTransaction,
} from '@teable/v2-adapter-db-postgres-shared';

const createContext = (transaction?: IUnitOfWorkTransaction): IExecutionContext => ({
  actorId: 'usrTest' as never,
  ...(transaction ? { transaction } : {}),
});

describe('shared Postgres unit of work helpers', () => {
  it('runs afterCommit handlers registered after the transaction has committed', async () => {
    const transaction = new PostgresUnitOfWorkTransaction(
      {} as unknown as Transaction<unknown>,
      'data'
    );
    const calls: string[] = [];

    transaction.afterCommit(() => {
      calls.push('before');
    });
    await transaction.runAfterCommitHandlers();
    transaction.afterCommit(() => {
      calls.push('after');
    });

    expect(transaction.committed).toBe(true);
    expect(calls).toEqual(['before', 'after']);
  });

  it('awaits afterCommit handlers registered while commit handlers are running', async () => {
    const transaction = new PostgresUnitOfWorkTransaction(
      {} as unknown as Transaction<unknown>,
      'data'
    );
    const calls: string[] = [];

    transaction.afterCommit(() => {
      calls.push('outer');
      transaction.afterCommit(() => {
        calls.push('inner');
      });
    });

    await transaction.runAfterCommitHandlers();

    expect(transaction.committed).toBe(true);
    expect(calls).toEqual(['outer', 'inner']);
  });

  it('ignores afterCommit handlers registered after rollback', async () => {
    const transaction = new PostgresUnitOfWorkTransaction(
      {} as unknown as Transaction<unknown>,
      'data'
    );
    const calls: string[] = [];

    transaction.afterRollback(() => {
      calls.push('rollback');
    });
    await transaction.runAfterRollbackHandlers();
    transaction.afterCommit(() => {
      calls.push('commit');
    });

    expect(transaction.rolledBack).toBe(true);
    expect(calls).toEqual(['rollback']);
  });

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
