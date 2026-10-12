import { createPrismaPgAdapter } from '@teable/db-main-prisma';
import { Pool } from 'pg';
import type { QueryResult } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

const CONNECT_TIMEOUT = 'Connection terminated due to connection timeout';
const rawQuery = { sql: 'SELECT 1', args: [], argTypes: [] as [] };

const emptyQueryResult: QueryResult = {
  rows: [],
  fields: [],
  command: 'SELECT',
  rowCount: 0,
  oid: 0,
};

const createPool = () =>
  new Pool({
    connectionString: 'postgresql://teable:teable@127.0.0.1:1/teable',
    connectionTimeoutMillis: 1,
    idleTimeoutMillis: 1,
    max: 1,
  });

describe('createPrismaPgAdapter connect timeout retry', () => {
  const pools: Pool[] = [];

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.end()));
  });

  it('retries pool.query once after a TCP connect timeout and then succeeds', async () => {
    const pool = createPool();
    pools.push(pool);
    const query = vi
      .spyOn(pool, 'query')
      .mockImplementationOnce(async () => {
        throw new Error(CONNECT_TIMEOUT);
      })
      .mockImplementationOnce(async () => emptyQueryResult);

    const adapter = createPrismaPgAdapter(pool);
    await expect(adapter.queryRaw(rawQuery)).resolves.toMatchObject({
      ok: true,
      value: { rows: [] },
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not retry a connect timeout more than once', async () => {
    const pool = createPool();
    pools.push(pool);
    const query = vi.spyOn(pool, 'query').mockRejectedValue(new Error(CONNECT_TIMEOUT));

    const adapter = createPrismaPgAdapter(pool);
    await expect(adapter.queryRaw(rawQuery)).rejects.toThrow(CONNECT_TIMEOUT);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-connect error', async () => {
    const pool = createPool();
    pools.push(pool);
    const query = vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error('syntax error'));

    const adapter = createPrismaPgAdapter(pool);
    await expect(adapter.queryRaw(rawQuery)).rejects.toThrow('syntax error');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
