import { createPrismaPgAdapter } from '@teable/db-main-prisma';
import { DatabaseError, Pool } from 'pg';
import type { PoolClient, QueryResult } from 'pg';
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

describe('createPrismaPgAdapter', () => {
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

  it.each(['P0001', '40P01', '40001', '23505'])('preserves COMMIT %s errors', async (code) => {
    const pool = createPool();
    pools.push(pool);
    const driverError = new DatabaseError('deferred constraint rejected COMMIT', 0, 'error');
    driverError.code = code;
    driverError.severity = 'ERROR';
    const query = vi.fn().mockRejectedValue(driverError);
    const release = vi.fn();
    vi.spyOn(pool, 'connect').mockResolvedValue({ query, release } as unknown as PoolClient);

    const context = await createPrismaPgAdapter(pool).transactionContext();
    if (!context.ok) throw new Error('Expected a transaction context');
    const transaction = await context.value.startTransaction();
    if (!transaction.ok) throw new Error('Expected a transaction');

    const error = await transaction.value
      .executeRaw({ ...rawQuery, sql: 'COMMIT' })
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ message: driverError.message, cause: driverError, code });
    expect((error as Error & { cause: unknown }).cause).toBe(driverError);
    expect(error).not.toHaveProperty('severity');
    expect(driverError).toMatchObject({ code, severity: 'ERROR' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ text: 'COMMIT' }), []);
    expect(release).not.toHaveBeenCalled();

    await expect(transaction.value.rollback()).resolves.toMatchObject({ ok: true });
    expect(release).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('keeps ordinary PostgreSQL query errors as Result.err inside a transaction', async () => {
    const pool = createPool();
    pools.push(pool);
    const driverError = new DatabaseError('syntax error at or near SELECT', 0, 'error');
    driverError.code = '42601';
    driverError.severity = 'ERROR';
    const query = vi.fn().mockRejectedValue(driverError);
    const release = vi.fn();
    vi.spyOn(pool, 'connect').mockResolvedValue({ query, release } as unknown as PoolClient);

    const context = await createPrismaPgAdapter(pool).transactionContext();
    if (!context.ok) throw new Error('Expected a transaction context');
    const transaction = await context.value.startTransaction();
    if (!transaction.ok) throw new Error('Expected a transaction');

    await expect(transaction.value.executeRaw(rawQuery)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'Postgres', code: '42601', severity: 'ERROR', message: driverError.message },
    });
    expect(query).toHaveBeenCalledTimes(1);
    await transaction.value.rollback();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
