import { EventEmitter } from 'node:events';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cancelPostgresQuery, type PostgresProtocolConnectionConstructor } from './cancelRequest';
import { createCancellablePool } from './cancellablePool';
import { PostgresQueryCancelledError, runWithPostgresQueryCancellation } from './queryCancellation';

vi.mock('./cancelRequest', () => ({ cancelPostgresQuery: vi.fn() }));

const createPool = () => {
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  });
  const raw = { connect: vi.fn().mockResolvedValue(client), end: vi.fn() };
  const pool = createCancellablePool(
    raw as unknown as Pool,
    class {} as unknown as PostgresProtocolConnectionConstructor,
    false
  );
  return { client, pool };
};

describe('leased PostgreSQL client failures', () => {
  afterEach(() => vi.clearAllMocks());

  it.each([undefined, new AbortController().signal])(
    'retains a between-statement failure and destroys only once with scope %s',
    async (signal) => {
      const { client, pool } = createPool();
      await runWithPostgresQueryCancellation(signal, async () => {
        const lease = await pool.connect();
        await lease.query('SELECT 1', []);
        const failure = Object.assign(
          new Error('terminating connection due to administrator command'),
          { code: '57P01' }
        );
        expect(() => client.emit('error', failure)).not.toThrow();
        await expect(lease.query('SELECT 2', [])).rejects.toBe(failure);
        lease.release();
        lease.release();
        expect(client.query).toHaveBeenCalledTimes(1);
        expect(client.release).toHaveBeenCalledExactlyOnceWith(failure);
        expect(client.listenerCount('error')).toBe(0);
      });
    }
  );

  it('rejects an active statement even if it resolves after the socket failure', async () => {
    const { client, pool } = createPool();
    const result = Promise.withResolvers<{ rows: unknown[]; rowCount: number }>();
    client.query.mockReturnValueOnce(result.promise);
    const lease = await pool.connect();
    const query = lease.query('SELECT 1', []);
    const rejected = expect(query).rejects.toThrow('Connection terminated unexpectedly');
    const failure = new Error('Connection terminated unexpectedly');
    client.emit('error', failure);
    lease.release();
    expect(client.release).not.toHaveBeenCalled();
    result.resolve({ rows: [], rowCount: 0 });
    await rejected;
    expect(client.release).toHaveBeenCalledExactlyOnceWith(failure);
    await expect(lease.query('SELECT 2', [])).rejects.toBe(failure);
  });

  it('hands a healthy client back to the idle pool error lifecycle', async () => {
    const { client, pool } = createPool();
    const idleError = vi.fn();
    client.release.mockImplementation(() => {
      client.on('error', idleError);
    });
    const lease = await pool.connect();
    lease.release();
    const failure = new Error('idle connection lost');
    client.emit('error', failure);
    expect(idleError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(client.listenerCount('error')).toBe(1);
  });

  it('waits for both the active SQL and cancellation socket before destroying a failed lease', async () => {
    const { client, pool } = createPool();
    const result = Promise.withResolvers<{ rows: unknown[]; rowCount: number }>();
    const control = Promise.withResolvers<void>();
    vi.mocked(cancelPostgresQuery).mockReturnValueOnce(control.promise);
    client.query.mockReturnValueOnce(result.promise);
    const abort = new AbortController();
    await expect(
      runWithPostgresQueryCancellation(abort.signal, async () => {
        const lease = await pool.connect();
        const query = lease.query('SELECT pg_sleep(10)', []);
        const rejected = expect(query).rejects.toBeInstanceOf(PostgresQueryCancelledError);
        abort.abort();
        lease.release();
        result.resolve({ rows: [], rowCount: 0 });
        await rejected;
        expect(client.release).not.toHaveBeenCalled();
        const failure = new Error('Connection terminated unexpectedly');
        client.emit('error', failure);
        expect(client.release).not.toHaveBeenCalled();
        control.resolve();
        await vi.waitFor(() => expect(client.release).toHaveBeenCalledExactlyOnceWith(failure));
        lease.release();
        expect(client.release).toHaveBeenCalledTimes(1);
      })
    ).rejects.toBeInstanceOf(PostgresQueryCancelledError);
  });
});
