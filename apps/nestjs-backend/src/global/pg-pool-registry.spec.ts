import { PgPoolRegistry } from '@teable/db-main-prisma';
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

describe('PgPoolRegistry', () => {
  afterEach(() => vi.unstubAllEnvs());

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
});
