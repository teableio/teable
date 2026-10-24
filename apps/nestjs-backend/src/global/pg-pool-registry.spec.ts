import { Logger } from '@nestjs/common';
import type { PgPoolObserver } from '@teable/db-main-prisma';
import {
  installPgPoolObserver,
  PgPoolRegistry,
  pgPoolObserverFacade,
} from '@teable/db-main-prisma';
import type { Pool, PoolConfig } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

const createPoolFactory = () => {
  const pools: Array<Pool & { end: ReturnType<typeof vi.fn> }> = [];
  const factory = vi.fn((config: PoolConfig) => {
    const pool = {
      options: config,
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0,
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool & { end: ReturnType<typeof vi.fn> };
    pools.push(pool);
    return pool;
  });
  return { factory, pools };
};

/** A pool that behaves like pg's: event listeners plus an acquirable client. */
const createObservedPoolFactory = () => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const connect = vi.fn();
  // The registry only touches the counters, the listeners and the wrapped `connect`, so a
  // stand-in object is enough; a real `pg.Pool` would try to dial the database.
  const pool = {
    idleCount: 1,
    options: {} as PoolConfig,
    totalCount: 1,
    waitingCount: 0,
    connect,
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
    }),
  } as unknown as Pool & { connect: typeof connect };
  const factory = vi.fn((config: PoolConfig) => {
    Object.assign(pool, { options: config });
    return pool;
  });
  return {
    connect,
    pool,
    factory,
    emit: (event: string, payload?: unknown) => listeners.get(event)?.(payload),
  };
};

const createObserver = () => ({
  onPoolCreated: vi.fn(),
  onConnectEstablished: vi.fn(),
  onPoolError: vi.fn(),
  onAcquireFailure: vi.fn(),
  onAcquireSettled: vi.fn(),
  onAcquireQueued: vi.fn(),
});

describe('PgPoolRegistry', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    installPgPoolObserver(undefined);
  });

  it('shares unnamed callers for the same physical database until the final lease is released', async () => {
    const { factory, pools } = createPoolFactory();
    const registry = new PgPoolRegistry(factory);
    const baseUrl = 'postgresql://teable:secret@db.example.com:5432/teable';

    const meta = registry.acquire(`${baseUrl}?schema=public&connection_limit=32`);
    const data = registry.acquire(
      'postgres://teable:secret@db.example.com/teable?schema=data&connection_limit=32'
    );

    expect(meta.pool).toBe(data.pool);
    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith({
      application_name: 'teable',
      connectionString: baseUrl,
      connectionTimeoutMillis: 5000,
      max: 32,
    });
    expect(registry.snapshot()).toEqual([
      expect.objectContaining({
        applicationName: 'teable',
        database: 'teable',
        host: 'db.example.com',
        max: 32,
        port: 5432,
        references: 2,
      }),
    ]);
    expect(registry.snapshot()[0]).not.toHaveProperty('poolName');

    await meta.release();
    expect(pools[0]!.end).not.toHaveBeenCalled();

    await data.release();
    expect(pools[0]!.end).toHaveBeenCalledOnce();
    expect(registry.snapshot()).toEqual([]);
  });

  it('shares one physical pool for the same database and pool name', async () => {
    const { factory } = createPoolFactory();
    const registry = new PgPoolRegistry(factory);
    const databaseUrl = 'postgresql://teable:secret@db.example.com:5432/teable';
    const options = {
      applicationName: 'teable-observation',
      connectionTimeoutMillis: 250,
      max: 1,
      poolName: 'observation',
    };

    const first = registry.acquire(databaseUrl, options);
    const second = registry.acquire(databaseUrl, options);

    expect(first.pool).toBe(second.pool);
    expect(factory).toHaveBeenCalledOnce();
    expect(registry.snapshot()).toEqual([
      expect.objectContaining({
        applicationName: 'teable-observation',
        max: 1,
        poolName: 'observation',
        references: 2,
      }),
    ]);

    await first.release();
    await second.release();
  });

  it('isolates different pool names and applies their independent limits', async () => {
    const { factory, pools } = createPoolFactory();
    const registry = new PgPoolRegistry(factory);
    const databaseUrl = 'postgresql://teable:secret@db.example.com:5432/teable';

    const observation = registry.acquire(databaseUrl, {
      applicationName: 'teable-observation',
      connectionTimeoutMillis: 250,
      max: 1,
      poolName: 'observation',
    });
    const analytics = registry.acquire(databaseUrl, {
      applicationName: 'teable-analytics',
      connectionTimeoutMillis: 1500,
      max: 4,
      poolName: 'analytics',
    });

    expect(observation.pool).not.toBe(analytics.pool);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenNthCalledWith(1, {
      application_name: 'teable-observation',
      connectionString: databaseUrl,
      connectionTimeoutMillis: 250,
      max: 1,
    });
    expect(factory).toHaveBeenNthCalledWith(2, {
      application_name: 'teable-analytics',
      connectionString: databaseUrl,
      connectionTimeoutMillis: 1500,
      max: 4,
    });
    expect(registry.snapshot()).toEqual([
      expect.objectContaining({
        applicationName: 'teable-analytics',
        max: 4,
        poolName: 'analytics',
      }),
      expect.objectContaining({
        applicationName: 'teable-observation',
        max: 1,
        poolName: 'observation',
      }),
    ]);

    await observation.release();
    expect(pools[0]!.end).toHaveBeenCalledOnce();
    expect(pools[1]!.end).not.toHaveBeenCalled();

    await analytics.release();
    expect(pools[1]!.end).toHaveBeenCalledOnce();
  });

  it('lets the process pool budget override legacy per-client connection limits', async () => {
    vi.stubEnv('DATABASE_POOL_MAX', '8');
    const { factory } = createPoolFactory();
    const registry = new PgPoolRegistry(factory);

    const lease = registry.acquire(
      'postgresql://teable:secret@db.example.com:5432/teable?connection_limit=32'
    );

    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ max: 8 }));
    await lease.release();
  });

  it('applies a short connectionTimeoutMillis by default and allows env override', async () => {
    vi.stubEnv('DATABASE_POOL_CONNECTION_TIMEOUT_MS', '2500');
    const { factory } = createPoolFactory();
    const registry = new PgPoolRegistry(factory);

    const lease = registry.acquire('postgresql://teable:secret@db.example.com:5432/teable');

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({ connectionTimeoutMillis: 2500 })
    );
    await lease.release();
  });

  it('lets acquire options override the connection timeout', async () => {
    const { factory } = createPoolFactory();
    const registry = new PgPoolRegistry(factory);

    const lease = registry.acquire('postgresql://teable:secret@db.example.com:5432/teable', {
      connectionTimeoutMillis: 1000,
    });

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({ connectionTimeoutMillis: 1000 })
    );
    await lease.release();
  });

  it('keeps physically different databases isolated', async () => {
    const { factory, pools } = createPoolFactory();
    const registry = new PgPoolRegistry(factory);

    const first = registry.acquire('postgresql://teable:secret@db.example.com:5432/meta');
    const second = registry.acquire('postgresql://teable:secret@db.example.com:5432/data');

    expect(first.pool).not.toBe(second.pool);
    expect(factory).toHaveBeenCalledTimes(2);

    await registry.onApplicationShutdown();
    expect(pools[0]!.end).toHaveBeenCalledOnce();
    expect(pools[1]!.end).toHaveBeenCalledOnce();
  });

  it('reports pool creation, physical connects and idle client failures to the observer', async () => {
    const observer = createObserver();
    const { factory, emit } = createObservedPoolFactory();
    const logSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const registry = new PgPoolRegistry(factory, observer);

    const lease = registry.acquire('postgresql://teable:secret@db.example.com:5432/teable');
    expect(observer.onPoolCreated).toHaveBeenCalledOnce();
    expect(observer.onPoolCreated).toHaveBeenCalledWith(
      expect.objectContaining({ database: 'teable', host: 'db.example.com', port: 5432 })
    );

    emit('connect');
    expect(observer.onConnectEstablished).toHaveBeenCalledWith(
      expect.objectContaining({ database: 'teable', host: 'db.example.com', port: 5432 })
    );

    const idleError = new Error('terminating connection due to administrator command');
    emit('error', idleError);
    expect(observer.onPoolError).toHaveBeenCalledWith(expect.any(Object), idleError);
    expect(logSpy).toHaveBeenCalledOnce();

    await lease.release();
  });

  it('measures callback-style acquisitions without changing the callback contract', async () => {
    const observer = createObserver();
    const { factory, connect } = createObservedPoolFactory();
    const registry = new PgPoolRegistry(factory, observer);
    const lease = registry.acquire('postgresql://teable:secret@db.example.com:5432/teable');
    const client = { id: 'client-1' };
    const done = () => undefined;
    connect.mockImplementation((callback: (...args: unknown[]) => void) => {
      callback(undefined, client, done);
      return undefined;
    });
    const callback = vi.fn();

    (lease.pool.connect as unknown as (callback: unknown) => void)(callback);

    expect(callback).toHaveBeenCalledWith(undefined, client, done);
    expect(observer.onAcquireSettled).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'db.example.com' }),
      'acquire',
      expect.any(Number),
      false
    );
    expect(observer.onAcquireFailure).not.toHaveBeenCalled();

    await lease.release();
  });

  it('reports queue admission but not immediate or physical-connection acquisitions', async () => {
    vi.useFakeTimers();
    try {
      const observer = createObserver();
      const { factory, pool, connect } = createObservedPoolFactory();
      const registry = new PgPoolRegistry(factory, observer);
      const lease = registry.acquire('postgresql://teable:secret@db.example.com:5432/teable', {
        max: 1,
        poolName: 'shared',
      });

      // One idle client and two synchronous callers: pg appends both, then dispenses the
      // idle client to the first on the next pulse. The second is actually queued.
      let releaseFirst: (() => void) | undefined;
      let releaseSecond: (() => void) | undefined;
      connect.mockImplementationOnce(() => {
        Object.assign(pool, { waitingCount: pool.waitingCount + 1 });
        return new Promise((resolve) => {
          releaseFirst = () => {
            Object.assign(pool, { idleCount: 0, waitingCount: pool.waitingCount - 1 });
            resolve({ id: 'idle-client' });
          };
        });
      });
      connect.mockImplementationOnce(() => {
        Object.assign(pool, { waitingCount: pool.waitingCount + 1 });
        return new Promise((resolve) => {
          releaseSecond = () => {
            Object.assign(pool, { waitingCount: pool.waitingCount - 1 });
            resolve({ id: 'queued-client' });
          };
        });
      });

      const first = lease.pool.connect();
      const second = lease.pool.connect();
      await vi.advanceTimersByTimeAsync(37);
      releaseSecond?.();
      await expect(second).resolves.toEqual({ id: 'queued-client' });
      expect(observer.onAcquireQueued).toHaveBeenCalledOnce();
      expect(observer.onAcquireQueued).toHaveBeenCalledWith(
        expect.objectContaining({ max: 1, poolName: 'shared' }),
        37,
        false
      );

      releaseFirst?.();
      await expect(first).resolves.toEqual({ id: 'idle-client' });
      expect(observer.onAcquireQueued).toHaveBeenCalledOnce();

      // A physical connection and a synchronously rejected acquisition do not join the
      // pending queue, so neither emits the queue histogram.
      Object.assign(pool, { idleCount: 0, totalCount: 0, waitingCount: 0 });
      connect.mockResolvedValueOnce({ id: 'new-client' });
      await expect(lease.pool.connect()).resolves.toEqual({ id: 'new-client' });
      expect(observer.onAcquireQueued).toHaveBeenCalledOnce();

      const rejection = new Error('Cannot use a pool after calling end on the pool');
      connect.mockRejectedValueOnce(rejection);
      await expect(lease.pool.connect()).rejects.toBe(rejection);
      expect(observer.onAcquireQueued).toHaveBeenCalledOnce();

      await lease.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it('measures promise-style acquisitions and keeps a retry as its own attempt', async () => {
    const observer = createObserver();
    const { factory, connect } = createObservedPoolFactory();
    const registry = new PgPoolRegistry(factory, observer);
    const lease = registry.acquire('postgresql://teable:secret@db.example.com:5432/teable');
    const connectTimeout = Object.assign(new Error('timeout exceeded when trying to connect'), {
      code: 'ETIMEDOUT',
    });
    const client = { id: 'client-1' };
    // Prisma's pg adapter retries a connection timeout once, with a fresh `pool.connect()`:
    // each attempt is its own observation.
    connect.mockRejectedValueOnce(connectTimeout).mockResolvedValueOnce(client);

    await expect(lease.pool.connect()).rejects.toBe(connectTimeout);
    await expect(lease.pool.connect()).resolves.toBe(client);

    expect(observer.onAcquireSettled).toHaveBeenCalledTimes(2);
    expect(observer.onAcquireSettled).toHaveBeenLastCalledWith(
      expect.any(Object),
      'acquire',
      expect.any(Number),
      false
    );
    expect(observer.onAcquireFailure).toHaveBeenCalledOnce();
    expect(observer.onAcquireFailure).toHaveBeenCalledWith(
      expect.any(Object),
      connectTimeout,
      'connect',
      expect.any(Number)
    );

    await lease.release();
  });

  it('never lets a throwing observer change the pool result or break the pool', async () => {
    const boom = new Error('observer is broken');
    const observer: PgPoolObserver = {
      onPoolCreated: () => {
        throw boom;
      },
      onConnectEstablished: () => {
        throw boom;
      },
      onPoolError: () => {
        throw boom;
      },
      onAcquireFailure: () => {
        throw boom;
      },
      onAcquireSettled: () => {
        throw boom;
      },
      onAcquireQueued: () => {
        throw boom;
      },
    };
    const { factory, connect, emit } = createObservedPoolFactory();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const registry = new PgPoolRegistry(factory, observer);
    const lease = registry.acquire('postgresql://teable:secret@db.example.com:5432/teable');
    const failure = Object.assign(new Error('pool is closed'), { code: '57P01' });
    connect.mockRejectedValue(failure);

    await expect(lease.pool.connect()).rejects.toBe(failure);
    expect(() => emit('connect')).not.toThrow();
    expect(() => emit('error', new Error('idle failure'))).not.toThrow();

    await lease.release();
  });

  it('reaches the observer installed after bootstrap through the DI facade', async () => {
    const installed = createObserver();
    const { factory, emit } = createObservedPoolFactory();
    installPgPoolObserver(installed);
    const registry = new PgPoolRegistry(factory, pgPoolObserverFacade);

    const lease = registry.acquire('postgresql://teable:secret@db.example.com:5432/teable');
    emit('connect');

    expect(installed.onPoolCreated).toHaveBeenCalledOnce();
    expect(installed.onConnectEstablished).toHaveBeenCalledOnce();

    await lease.release();
  });

  it('is a no-op without an observer, and without one installed in the facade', async () => {
    const { factory, connect, emit } = createObservedPoolFactory();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const registry = new PgPoolRegistry(factory, pgPoolObserverFacade);
    const lease = registry.acquire('postgresql://teable:secret@db.example.com:5432/teable');
    connect.mockResolvedValue({ id: 'client-1' });

    await expect(lease.pool.connect()).resolves.toEqual({ id: 'client-1' });
    expect(() => emit('error', new Error('idle failure'))).not.toThrow();

    await lease.release();
  });
});
