import { ActorId, type IExecutionContext } from '@teable/v2-core';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool as PgPool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { V2PgTableSchemaCoordination } from './schemaCoordination';

const APPLICATION_NAME = 'teable-v2-schema-coordination-test';

type AcquireResult = {
  isOk(): boolean;
  value: { release(): Promise<void> };
};
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

  it('grants shared leases to concurrent holders and blocks exclusive until they release', async () => {
    let first: AcquireResult | undefined;
    let second: AcquireResult | undefined;
    let exclusivePromise: Promise<AcquireResult> | undefined;

    try {
      first = await coordination.acquire(createContext(), [TABLE_A], 'shared');
      second = await coordination.acquire(createContext(), [TABLE_A], 'shared');
      const firstLease = first.value;
      const secondLease = second.value;

      exclusivePromise = coordination.acquire(createContext(), [TABLE_A], 'exclusive');
      await waitForAdvisoryWaiter(observer);

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
    }
  });

  it('blocks a shared lease until the exclusive holder releases', async () => {
    let exclusive: AcquireResult | undefined;
    let sharedPromise: Promise<AcquireResult> | undefined;

    try {
      exclusive = await coordination.acquire(createContext(), [TABLE_A], 'exclusive');
      const exclusiveLease = exclusive.value;
      sharedPromise = coordination.acquire(createContext(), [TABLE_A], 'shared');

      await waitForAdvisoryWaiter(observer);

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
        },
        { timeout: 5_000, interval: 20 }
      );

      // Without the checked-out client error listener this would be an
      // unhandled 'error' event; the lease must also not COMMIT a dead socket.
      await lease.release();

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
});
