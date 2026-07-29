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

  it('shares one pool for the same physical database until the final lease is released', async () => {
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
        database: 'teable',
        host: 'db.example.com',
        max: 32,
        port: 5432,
        references: 2,
      }),
    ]);

    await meta.release();
    expect(pools[0]!.end).not.toHaveBeenCalled();

    await data.release();
    expect(pools[0]!.end).toHaveBeenCalledOnce();
    expect(registry.snapshot()).toEqual([]);
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
