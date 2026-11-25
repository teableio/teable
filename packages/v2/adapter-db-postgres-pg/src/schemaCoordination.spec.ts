import { pgErrorCode } from '@teable/v2-adapter-db-postgres-shared';
import { ActorId, type DomainError, type IExecutionContext } from '@teable/v2-core';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Result } from 'neverthrow';
import { Pool as PgPool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { V2PgTableSchemaCoordination, type ICoordinationLease } from './schemaCoordination';

const APPLICATION_NAME = 'teable-v2-schema-coordination-test';

type AcquireResult = Result<ICoordinationLease, DomainError>;
const TABLE_A = `tbl${'a'.repeat(16)}`;
const TABLE_B = `tbl${'b'.repeat(16)}`;

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

const countAdvisoryWaiters = async (observer: PgPool, applicationName = APPLICATION_NAME) => {
  const result = await observer.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM pg_locks locks
       JOIN pg_stat_activity activity ON activity.pid = locks.pid
      WHERE locks.locktype = 'advisory'
        AND NOT locks.granted
        AND activity.application_name = $1`,
    [applicationName]
  );
  return Number(result.rows[0]?.count ?? 0);
};

const waitForAdvisoryWaiter = async (observer: PgPool, applicationName?: string) => {
  await vi.waitFor(
    async () => {
      expect(await countAdvisoryWaiters(observer, applicationName)).toBeGreaterThan(0);
    },
    { timeout: 5_000, interval: 20 }
  );
};

describe('V2PgTableSchemaCoordination', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let coordination: V2PgTableSchemaCoordination;
  let observer: PgPool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    coordination = new V2PgTableSchemaCoordination({
      connectionString: container.getConnectionUri(),
      maxConnections: 4,
      applicationName: APPLICATION_NAME,
    });
    observer = new PgPool({ connectionString: container.getConnectionUri() });
  }, 120_000);

  afterAll(async () => {
    await coordination?.destroy();
    await observer?.end();
    await container?.stop();
  });

  it('grants concurrent shared leases and blocks an exclusive lease from another pool', async () => {
    const otherPool = new V2PgTableSchemaCoordination({
      connectionString: container!.getConnectionUri(),
      applicationName: `${APPLICATION_NAME}-cross-pool`,
    });
    let first: AcquireResult | undefined;
    let second: AcquireResult | undefined;
    let exclusivePromise: Promise<AcquireResult> | undefined;

    try {
      first = await coordination.acquire(createContext(), [TABLE_A], 'shared');
      second = await coordination.acquire(createContext(), [TABLE_A], 'shared');
      const firstLease = first._unsafeUnwrap();
      const secondLease = second._unsafeUnwrap();

      exclusivePromise = otherPool.acquire(createContext(), [TABLE_A], 'exclusive');
      await waitForAdvisoryWaiter(observer, `${APPLICATION_NAME}-cross-pool`);

      await firstLease.release();
      let exclusiveSettled = false;
      void exclusivePromise.then(
        () => {
          exclusiveSettled = true;
        },
        () => {
          exclusiveSettled = true;
        }
      );
      await secondLease.release();

      const exclusive = (await exclusivePromise)._unsafeUnwrap();
      expect(exclusive.mode).toBe('exclusive');
      expect(exclusiveSettled).toBe(true);
      await exclusive.release();
    } finally {
      if (first?.isOk()) await first.value.release();
      if (second?.isOk()) await second.value.release();
      if (exclusivePromise) {
        const exclusive = await exclusivePromise;
        if (exclusive.isOk()) await exclusive.value.release();
      }
      await otherPool.destroy();
    }
  });

  it('blocks a shared lease from another pool until the exclusive holder releases', async () => {
    const otherPool = new V2PgTableSchemaCoordination({
      connectionString: container!.getConnectionUri(),
      applicationName: `${APPLICATION_NAME}-cross-pool`,
    });
    let exclusive: AcquireResult | undefined;
    let sharedPromise: Promise<AcquireResult> | undefined;

    try {
      exclusive = await coordination.acquire(createContext(), [TABLE_A], 'exclusive');
      const exclusiveLease = exclusive._unsafeUnwrap();
      sharedPromise = otherPool.acquire(createContext(), [TABLE_A], 'shared');

      await waitForAdvisoryWaiter(observer, `${APPLICATION_NAME}-cross-pool`);

      await exclusiveLease.release();
      const shared = (await sharedPromise)._unsafeUnwrap();
      expect(shared.mode).toBe('shared');
      await shared.release();
    } finally {
      if (exclusive?.isOk()) await exclusive.value.release();
      if (sharedPromise) {
        const shared = await sharedPromise;
        if (shared.isOk()) await shared.value.release();
      }
      await otherPool.destroy();
    }
  });

  it('does not block business queries when the coordination pool is exhausted', async () => {
    const applicationName = `${APPLICATION_NAME}-exhausted`;
    const local = new V2PgTableSchemaCoordination({
      connectionString: container!.getConnectionUri(),
      maxConnections: 1,
      applicationName,
    });

    try {
      const holder = (await local.acquire(createContext(), [TABLE_A], 'shared'))._unsafeUnwrap();

      // The coordinator's only connection is pinned by the holder; the second
      // acquire queues inside its dedicated pool, not in the business pool.
      let queuedSettled = false;
      const queuedPromise = local.acquire(createContext(), [TABLE_A], 'shared');
      void queuedPromise.then(
        () => {
          queuedSettled = true;
        },
        () => {
          queuedSettled = true;
        }
      );

      const business = await observer.query<{ ok: number }>('SELECT 1 AS ok');
      expect(business.rows[0]?.ok).toBe(1);
      expect(queuedSettled).toBe(false);

      await holder.release();
      const queued = (await queuedPromise)._unsafeUnwrap();
      expect(queued.mode).toBe('shared');
      await queued.release();
    } finally {
      await local.destroy();
    }
  }, 20_000);

  it('allows another table to acquire while both lease modes queue on one table', async () => {
    const local = new V2PgTableSchemaCoordination({
      connectionString: container!.getConnectionUri(),
      maxConnections: 2,
      connectionTimeoutMillis: 2_000,
      applicationName: `${APPLICATION_NAME}-table-queue`,
    });
    const context = createContext();
    const abort = new AbortController();
    let holder: ICoordinationLease | undefined;
    let queued: Promise<AcquireResult> | undefined;
    let cancelled: Promise<AcquireResult> | undefined;
    let shared: Promise<AcquireResult> | undefined;
    try {
      holder = (await local.acquire(context, [TABLE_A], 'exclusive'))._unsafeUnwrap();
      cancelled = local.acquire(context, [TABLE_A], 'exclusive', abort.signal);
      queued = local.acquire(context, [TABLE_A], 'exclusive');
      shared = local.acquire(context, [TABLE_A], 'shared');

      const other = (await local.acquire(context, [TABLE_B], 'exclusive'))._unsafeUnwrap();
      await other.release();
      abort.abort();
      expect((await cancelled)._unsafeUnwrapErr().code).toBe('schema_coordination.cancelled');

      await holder.release();
      const successor = (await queued)._unsafeUnwrap();
      expect(successor.tableIds).toEqual([TABLE_A]);
      await successor.release();
      const reader = (await shared)._unsafeUnwrap();
      expect(reader.mode).toBe('shared');
      await reader.release();
    } finally {
      abort.abort();
      await holder?.release();
      for (const pending of [cancelled, queued, shared]) {
        const result = await pending;
        if (result?.isOk()) await result.value.release();
      }
      await local.destroy();
    }
  }, 20_000);

  it('destroys a checked-out client after a connection error and keeps release safe', async () => {
    const applicationName = `${APPLICATION_NAME}-client-error`;
    const local = new V2PgTableSchemaCoordination({
      connectionString: container!.getConnectionUri(),
      maxConnections: 2,
      applicationName,
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const lease = (await local.acquire(createContext(), [TABLE_A], 'shared'))._unsafeUnwrap();
      expect(lease.isActive).toBe(true);

      const pidResult = await observer.query<{ pid: number }>(
        `SELECT pid
           FROM pg_stat_activity
          WHERE application_name = $1
            AND state = 'idle in transaction'`,
        [applicationName]
      );
      expect(pidResult.rows).toHaveLength(1);

      await observer.query('SELECT pg_terminate_backend($1)', [pidResult.rows[0]!.pid]);

      await vi.waitFor(
        async () => {
          expect(consoleError).toHaveBeenCalledWith(
            '[v2-adapter-db-postgres-pg] Table schema coordination connection failed',
            expect.anything()
          );
          expect(lease.isActive).toBe(false);
        },
        { timeout: 5_000, interval: 20 }
      );

      // Without the checked-out client error listener this would be an
      // unhandled 'error' event; the lease must also not COMMIT a dead socket.
      await lease.release();
      expect(lease.isActive).toBe(false);

      const exclusive = (
        await local.acquire(createContext(), [TABLE_A], 'exclusive')
      )._unsafeUnwrap();
      await exclusive.release();
    } finally {
      consoleError.mockRestore();
      await local.destroy();
    }
  }, 20_000);

  it('rejects a queued acquire instead of hanging when destroyed', async () => {
    const local = new V2PgTableSchemaCoordination({
      connectionString: container!.getConnectionUri(),
      maxConnections: 1,
      applicationName: `${APPLICATION_NAME}-destroy`,
    });

    try {
      const holder = (await local.acquire(createContext(), [TABLE_B], 'shared'))._unsafeUnwrap();
      const queued = local.acquire(createContext(), [TABLE_B], 'shared');

      const destroyPromise = local.destroy();
      const queuedResult = await queued;
      expect(queuedResult.isErr()).toBe(true);

      const afterDestroy = await local.acquire(createContext(), [TABLE_B], 'shared');
      expect(afterDestroy._unsafeUnwrapErr().code).toBe('schema_coordination.pool_destroyed');

      await holder.release();
      await destroyPromise;
    } finally {
      await local.destroy();
    }
  }, 20_000);

  it('destroys checked-out advisory waiters without waiting for the external exclusive holder', async () => {
    const applicationName = `${APPLICATION_NAME}-destroy-lock-waiter`;
    const local = new V2PgTableSchemaCoordination({
      connectionString: container!.getConnectionUri(),
      maxConnections: 2,
      applicationName,
    });
    const exclusive = (
      await coordination.acquire(createContext(), [TABLE_A], 'exclusive')
    )._unsafeUnwrap();
    const localHeld = (await local.acquire(createContext(), [TABLE_B], 'shared'))._unsafeUnwrap();
    let destroyPromise: Promise<void> | undefined;
    const waiting = local.acquire(createContext(), [TABLE_A], 'shared');
    try {
      await waitForAdvisoryWaiter(observer, applicationName);
      let destroyed = false;
      destroyPromise = local.destroy().then(() => {
        destroyed = true;
      });
      // The holder deliberately stays locked: the old pool.end() deadlocks here.
      await vi.waitFor(() => expect(destroyed).toBe(true), { timeout: 5_000, interval: 20 });
      expect((await waiting).isErr()).toBe(true);
      expect(localHeld.isActive).toBe(false);
      expect(localHeld.assertHeld).toBeDefined();
      expect((await localHeld.assertHeld!()).isErr()).toBe(true);
    } finally {
      await exclusive.release();
      const pending = await waiting;
      if (pending.isOk()) await pending.value.release();
      await localHeld.release();
      await (destroyPromise ?? local.destroy());
    }
  }, 20_000);

  it('times out a blocked advisory acquisition and releases its transaction for later writers', async () => {
    const local = new V2PgTableSchemaCoordination({
      connectionString: container!.getConnectionUri(),
      maxConnections: 1,
      applicationName: `${APPLICATION_NAME}-lock-timeout`,
      lockTimeoutMillis: 150,
    });
    const holder = (
      await coordination.acquire(createContext(), [TABLE_B], 'exclusive')
    )._unsafeUnwrap();
    try {
      const blocked = await local.acquire(createContext(), [TABLE_B], 'shared');
      expect(blocked.isErr()).toBe(true);
      expect(blocked._unsafeUnwrapErr().code).toBe('schema_coordination.busy');
      expect(blocked._unsafeUnwrapErr().tags).toContain('conflict');
      expect(pgErrorCode(blocked._unsafeUnwrapErr())).toBe('55P03');
      await holder.release();
      const recovered = (await local.acquire(createContext(), [TABLE_B], 'shared'))._unsafeUnwrap();
      await recovered.release();
    } finally {
      await holder.release();
      await local.destroy();
    }
  }, 5_000);

  it('cancels an acquisition and releases partial table locks before its blocker ends', async () => {
    const abort = new AbortController();
    let blocker: AcquireResult | undefined;
    let waiting: Promise<AcquireResult> | undefined;
    try {
      blocker = await coordination.acquire(createContext(), [TABLE_B], 'exclusive');
      let settled = false;
      waiting = coordination.acquire(createContext(), [TABLE_A, TABLE_B], 'shared', abort.signal);
      void waiting.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      await waitForAdvisoryWaiter(observer);

      abort.abort();
      await vi.waitFor(() => expect(settled).toBe(true), { timeout: 2_000, interval: 20 });
      expect((await waiting)._unsafeUnwrapErr().code).toBe('schema_coordination.cancelled');
      // B is still exclusively held: cancellation must release A's already-acquired
      // shared lock rather than waiting for the multi-table acquisition to finish.
      await vi.waitFor(
        async () => {
          const probe = await observer.query<{ acquired: boolean }>(
            'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired',
            [`teable.schema:table:${TABLE_A}`]
          );
          expect(probe.rows[0]?.acquired).toBe(true);
        },
        { timeout: 2_000, interval: 20 }
      );
    } finally {
      abort.abort();
      if (blocker?.isOk()) await blocker.value.release();
      if (waiting) {
        const result = await waiting;
        if (result.isOk()) await result.value.release();
      }
    }
  }, 20_000);

  it('cancels a queued checkout and disposes its late connection without starving the pool', async () => {
    const local = new V2PgTableSchemaCoordination({
      connectionString: container!.getConnectionUri(),
      maxConnections: 1,
      connectionTimeoutMillis: 5_000,
      applicationName: `${APPLICATION_NAME}-cancel-queued`,
    });
    const abort = new AbortController();
    let holder: AcquireResult | undefined;
    let waiting: Promise<AcquireResult> | undefined;
    try {
      holder = await local.acquire(createContext(), [TABLE_A], 'shared');
      let settled = false;
      waiting = local.acquire(createContext(), [TABLE_B], 'shared', abort.signal);
      void waiting.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      await vi.waitFor(
        () => {
          // Observe the real pg-pool queue, not a timer standing in for checkout.
          const pool: unknown = Reflect.get(local, 'pool');
          if (!(pool instanceof PgPool)) throw new Error('Coordinator pool was not initialized');
          expect(pool.waitingCount).toBe(1);
        },
        { timeout: 2_000, interval: 20 }
      );
      abort.abort();
      await vi.waitFor(() => expect(settled).toBe(true), { timeout: 2_000, interval: 20 });
      expect((await waiting)._unsafeUnwrapErr().code).toBe('schema_coordination.cancelled');

      await holder._unsafeUnwrap().release();
      const fresh = (await local.acquire(createContext(), [TABLE_B], 'exclusive'))._unsafeUnwrap();
      await fresh.release();
      const probe = await observer.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired',
        [`teable.schema:table:${TABLE_B}`]
      );
      expect(probe.rows[0]?.acquired).toBe(true);
    } finally {
      abort.abort();
      if (holder?.isOk()) await holder.value.release();
      if (waiting) {
        const result = await waiting;
        if (result.isOk()) await result.value.release();
      }
      await local.destroy();
    }
  }, 20_000);

  it('keeps a granted lease protected after its acquisition signal is aborted', async () => {
    const abort = new AbortController();
    const lease = (
      await coordination.acquire(createContext(), [TABLE_A], 'shared', abort.signal)
    )._unsafeUnwrap();
    try {
      abort.abort();
      expect(lease.fence).toEqual({
        backendPid: expect.any(Number),
        transactionId: expect.any(String),
      });
      expect(lease.isActive).toBe(true);
      expect(lease.assertHeld).toBeDefined();
      expect((await lease.assertHeld!()).isOk()).toBe(true);
      const probe = await observer.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired',
        [`teable.schema:table:${TABLE_A}`]
      );
      expect(probe.rows[0]?.acquired).toBe(false);
    } finally {
      await lease.release();
    }
    expect(lease.isActive).toBe(false);
    expect((await lease.assertHeld!())._unsafeUnwrapErr().code).toBe('actor_columns.lease_lost');
    const released = await observer.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired',
      [`teable.schema:table:${TABLE_A}`]
    );
    expect(released.rows[0]?.acquired).toBe(true);
  });
});
