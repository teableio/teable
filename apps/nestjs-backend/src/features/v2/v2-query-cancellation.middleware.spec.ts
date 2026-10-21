import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createV2PostgresDb,
  PostgresQueryCancelledError,
  runWithPostgresQueryCancellation,
} from '@teable/v2-adapter-db-postgres-pg';
import { PostgresUnitOfWorkTransaction } from '@teable/v2-adapter-db-postgres-shared';
import { ActorId, domainError, type IExecutionContext } from '@teable/v2-core';
import { sql, type Transaction } from 'kysely';
import { ClsService } from 'nestjs-cls';
import { err, ok } from 'neverthrow';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import type { IClsStore } from '../../types/cls';
import { V2QueryCancellationMiddleware } from './v2-query-cancellation.middleware';

const context: IExecutionContext = { actorId: ActorId.create('system')._unsafeUnwrap() };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const createFixture = async () => {
  const cls = new ClsService<IClsStore>(new AsyncLocalStorage());
  const middleware = new V2QueryCancellationMiddleware(cls);
  // Exercise the real Kysely/pg cancellation boundary without opening a network connection.
  // Physical CancelRequest behavior has its own real PostgreSQL integration suite.
  const client = {
    query: async () => ({ rows: [{ value: 42 }], rowCount: 1, command: 'SELECT' }),
    release: () => undefined,
  };
  const pool = { connect: async () => client, end: async () => undefined } as unknown as Pool;
  const db = await createV2PostgresDb(
    { pg: { connectionString: 'postgresql://unused/unused' } },
    { pool }
  );
  const read = async () => {
    const result = await sql<{ value: number }>`select 42 as value`.execute(db);
    return ok(result.rows[0].value);
  };
  const run = <T>(signal: AbortSignal | undefined, useV2: boolean, work: () => Promise<T>) =>
    cls.run(async () => {
      cls.set('useV2', useV2);
      cls.set('interactiveQueryAbort', signal);
      return work();
    });
  return { cls, middleware, db, read, run };
};

describe('V2QueryCancellationMiddleware', () => {
  const destroy: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(destroy.splice(0).map((close) => close()));
  });
  const fixture = async () => {
    const value = await createFixture();
    destroy.push(() => value.db.destroy());
    return value;
  };

  it('rejects pre-aborted interactive work before the query handler starts', async () => {
    const { middleware, run } = await fixture();
    const controller = new AbortController();
    controller.abort();
    let started = false;
    await expect(
      run(controller.signal, true, () =>
        middleware.handle(context, {}, async () => {
          started = true;
          return ok('unexpected work');
        })
      )
    ).rejects.toBeInstanceOf(PostgresQueryCancelledError);
    expect(started).toBe(false);
  });

  it('reads CLS per invocation and isolates concurrent requests in the shared middleware', async () => {
    const { middleware, run, read } = await fixture();
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    const bothStarted = deferred();
    const proceed = deferred();
    let started = 0;
    const next = async () => {
      if (++started === 2) bothStarted.resolve();
      await proceed.promise;
      return read();
    };
    const a = run(controllerA.signal, true, () => middleware.handle(context, {}, next));
    const aRejected = expect(a).rejects.toBeInstanceOf(PostgresQueryCancelledError);
    const b = run(controllerB.signal, true, () => middleware.handle(context, {}, next));
    await bothStarted.promise;
    controllerA.abort();
    proceed.resolve();
    await aRejected;
    expect((await b)._unsafeUnwrap()).toBe(42);
    expect(
      (
        await run(controllerB.signal, true, () => middleware.handle(context, {}, read))
      )._unsafeUnwrap()
    ).toBe(42);
  });

  it.each(['v1', 'unmarked', 'transaction'] as const)(
    'clears inherited cancellation for %s work and lets the database operation complete',
    async (branch) => {
      const { middleware, run, read, db } = await fixture();
      const controller = new AbortController();
      controller.abort();
      const queryContext =
        branch === 'transaction'
          ? {
              ...context,
              transaction: new PostgresUnitOfWorkTransaction(db as Transaction<unknown>, 'data'),
            }
          : context;
      const result = await runWithPostgresQueryCancellation(controller.signal, () =>
        run(branch === 'unmarked' ? undefined : controller.signal, branch !== 'v1', () =>
          middleware.handle(queryContext, {}, read)
        )
      );
      expect(result._unsafeUnwrap()).toBe(42);
    }
  );

  it.each(['result', 'throw'] as const)(
    'unwraps a dedicated cancellation through a DomainError %s',
    async (boundary) => {
      const { middleware, run } = await fixture();
      const controller = new AbortController();
      const cancellation = new PostgresQueryCancelledError({
        cause: Object.assign(new Error('cancelled'), { code: '57014' }),
      });
      const wrapped = domainError.infrastructure({
        message: 'record read failed',
        cause: domainError.unexpected({ message: 'query failed', cause: cancellation }),
      });
      await expect(
        run(controller.signal, true, () =>
          middleware.handle(context, {}, async () => {
            controller.abort();
            if (boundary === 'throw') throw wrapped;
            return err(wrapped);
          })
        )
      ).rejects.toBe(cancellation);
    }
  );

  it('does not turn genuine SQL errors into cancellation even if the request also disconnects', async () => {
    const { middleware, run } = await fixture();
    const controller = new AbortController();
    const timeout = Object.assign(new Error('statement timeout'), { code: '57014' });
    const wrapped = domainError.infrastructure({ message: 'query failed', cause: timeout });
    const result = await run(controller.signal, true, () =>
      middleware.handle(context, {}, async () => {
        controller.abort();
        return err(wrapped);
      })
    );
    expect(result._unsafeUnwrapErr()).toBe(wrapped);
    const otherController = new AbortController();
    await expect(
      run(otherController.signal, true, () =>
        middleware.handle(context, {}, async () => {
          otherController.abort();
          throw timeout;
        })
      )
    ).rejects.toBe(timeout);
  });

  it('keeps connected domain error mapping and refuses to cache successful work after abort', async () => {
    const { middleware, run } = await fixture();
    const controller = new AbortController();
    const wrapped = domainError.infrastructure({
      message: 'query failed',
      cause: new PostgresQueryCancelledError(),
    });
    const result = await run(controller.signal, true, () =>
      middleware.handle(context, {}, async () => err(wrapped))
    );
    expect(result._unsafeUnwrapErr()).toBe(wrapped);
    await expect(
      run(controller.signal, true, () =>
        middleware.handle(context, {}, async () => {
          controller.abort();
          return ok(42);
        })
      )
    ).rejects.toBeInstanceOf(PostgresQueryCancelledError);
  });
});
