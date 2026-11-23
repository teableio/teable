import {
  getPostgresTransaction,
  PostgresUnitOfWork,
  PostgresUnitOfWorkTransaction,
} from '@teable/v2-adapter-db-postgres-shared';
import { domainError, type IExecutionContext } from '@teable/v2-core';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type Transaction,
} from 'kysely';
import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

const fixture = () => {
  // Compile and execute real SAVEPOINT statements against the deterministic
  // no-I/O driver; callback lifecycle is independent of a running database.
  const db = new Kysely<unknown>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (client) => new PostgresIntrospector(client),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  const config = { pg: { connectionString: 'postgresql://local/teable' } };
  const uow = new PostgresUnitOfWork(db, db, config, config);
  const parent = new PostgresUnitOfWorkTransaction(db as unknown as Transaction<unknown>, 'data');
  const context: IExecutionContext = {
    actorId: 'usrTest' as never,
    transaction: parent,
    transactions: { data: parent, meta: parent },
  };
  return { db, uow, parent, context };
};

const failure = () => domainError.conflict({ message: 'unique conflict' });

describe('savepoint callback isolation', () => {
  it('promotes callbacks to the active transaction when a scoped binding is already rolled back', async () => {
    const { db, uow, parent, context } = fixture();
    const stale = new PostgresUnitOfWorkTransaction(db as unknown as Transaction<unknown>, 'data');
    const calls: string[] = [];
    await stale.runAfterRollbackHandlers();
    try {
      const result = await uow.savepoint({
        ...context,
        transactions: { data: stale, meta: parent },
      }, async (child) => {
        expect(child.transactions?.meta).toBe(child.transaction);
        child.transaction!.afterCommit!(() => { calls.push('child.commit'); });
        child.transaction!.afterRollback!(() => { calls.push('child.rollback'); });
        return ok(undefined);
      });
      expect(result.isOk()).toBe(true);
      expect(calls).toEqual([]);
      await parent.runAfterCommitHandlers();
      expect(calls).toEqual(['child.commit']);
    } finally {
      await db.destroy();
    }
  });


  it('releases only failed-attempt resources before retry and commits successful callbacks once', async () => {
    const { db, uow, parent, context } = fixture();
    const calls: string[] = [];
    parent.afterCommit(() => { calls.push('outer.commit'); });
    parent.afterRollback(() => { calls.push('outer.rollback'); });
    try {
      const failed = await uow.savepoint(context, async (child) => {
        expect(child.transaction).not.toBe(parent);
        expect(child.transactions?.data).toBe(child.transaction);
        expect(child.transactions?.meta).toBe(child.transaction);
        expect(getPostgresTransaction(child, 'data')).toBe(getPostgresTransaction(context, 'data'));
        child.transaction!.afterCommit!(() => { calls.push('failed.commit'); });
        child.transaction!.afterRollback!(() => { calls.push('failed.rollback'); });
        return err(failure());
      });
      expect(failed.isErr()).toBe(true);
      expect(calls).toEqual(['failed.rollback']);
      const succeeded = await uow.savepoint(context, async (child) => {
        expect(calls).toEqual(['failed.rollback']);
        child.transaction!.afterCommit!(() => { calls.push('retry.commit'); });
        child.transaction!.afterRollback!(() => { calls.push('retry.rollback'); });
        return ok('inserted');
      });
      expect(succeeded._unsafeUnwrap()).toBe('inserted');
      expect(calls).toEqual(['failed.rollback']);
      await parent.runAfterCommitHandlers();
      await parent.runAfterCommitHandlers();
      await parent.runAfterRollbackHandlers();
      expect(calls).toEqual(['failed.rollback', 'outer.commit', 'retry.commit']);
    } finally {
      await db.destroy();
    }
  });

  it('promotes nested success into its parent and rolls it back with that parent only', async () => {
    const { db, uow, parent, context } = fixture();
    const calls: string[] = [];
    parent.afterRollback(() => { calls.push('outer.rollback'); });
    try {
      const result = await uow.savepoint(context, async (child) => {
        child.transaction!.afterRollback!(() => { calls.push('child.rollback'); });
        const nested = await uow.savepoint(child, async (grandchild) => {
          expect(grandchild.transaction).not.toBe(child.transaction);
          grandchild.transaction!.afterCommit!(() => { calls.push('grandchild.commit'); });
          grandchild.transaction!.afterRollback!(() => { calls.push('grandchild.rollback'); });
          return ok(undefined);
        });
        expect(nested.isOk()).toBe(true);
        expect(calls).toEqual([]);
        return err(failure());
      });
      expect(result.isErr()).toBe(true);
      expect(calls).toEqual(['child.rollback', 'grandchild.rollback']);
      await parent.runAfterRollbackHandlers();
      await parent.runAfterRollbackHandlers();
      expect(calls).toEqual(['child.rollback', 'grandchild.rollback', 'outer.rollback']);
    } finally {
      await db.destroy();
    }
  });

  it('defers successful child rollback until the outer rollback and preserves an independent meta scope', async () => {
    const { db, uow, parent, context } = fixture();
    const meta = new PostgresUnitOfWorkTransaction(db as unknown as Transaction<unknown>, 'meta');
    const calls: string[] = [];
    try {
      const result = await uow.savepoint({ ...context, transactions: { data: parent, meta } }, async (child) => {
        expect(child.transactions?.meta).toBe(meta);
        child.transaction!.afterCommit!(() => { calls.push('child.commit'); });
        child.transaction!.afterRollback!(() => { calls.push('child.rollback'); });
        return ok(undefined);
      });
      expect(result.isOk()).toBe(true);
      expect(calls).toEqual([]);
      await parent.runAfterRollbackHandlers();
      await parent.runAfterCommitHandlers();
      await parent.runAfterRollbackHandlers();
      expect(calls).toEqual(['child.rollback']);
    } finally {
      await db.destroy();
    }
  });

  it('rolls back callbacks on a thrown attempt before propagating its original exception', async () => {
    const { db, uow, parent, context } = fixture();
    const calls: string[] = [];
    const exception = new Error('attempt failed');
    try {
      await expect(uow.savepoint(context, async (child) => {
        child.transaction!.afterCommit!(() => { calls.push('child.commit'); });
        child.transaction!.afterRollback!(() => { calls.push('child.rollback'); });
        throw exception;
      })).rejects.toBe(exception);
      expect(calls).toEqual(['child.rollback']);
      await parent.runAfterRollbackHandlers();
      expect(calls).toEqual(['child.rollback']);
    } finally {
      await db.destroy();
    }
  });

  it('runs rollback callbacks from an aborted outer transaction before retrying successful child work', async () => {
    const { db, uow, context } = fixture();
    const calls: string[] = [];
    let attempt = 0;
    try {
      const result = await uow.withTransaction({ actorId: context.actorId }, async (outer) => {
        const current = ++attempt;
        const child = await uow.savepoint(outer, async (inner) => {
          inner.transaction!.afterCommit!(() => { calls.push(`${current}.commit`); });
          inner.transaction!.afterRollback!(() => { calls.push(`${current}.rollback`); });
          return ok(undefined);
        });
        expect(child.isOk()).toBe(true);
        if (current === 1) return err(domainError.infrastructure({ message: 'deadlock detected' }));
        expect(calls).toEqual(['1.rollback']);
        return ok('committed');
      });
      expect(result._unsafeUnwrap()).toBe('committed');
      expect(calls).toEqual(['1.rollback', '2.commit']);
    } finally {
      await db.destroy();
    }
  });
});
