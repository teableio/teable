import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createV2PostgresDb, handlePgPoolError, shouldIgnorePgPoolError } from './createDb';

describe('createDb pg pool error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores administrator shutdown pool errors during teardown', () => {
    expect(
      shouldIgnorePgPoolError(
        Object.assign(new Error('terminating connection due to administrator command'), {
          code: '57P01',
        })
      )
    ).toBe(true);

    expect(
      shouldIgnorePgPoolError(
        Object.assign(new Error('terminating connection due to crash of another server process'), {
          code: '57P02',
        })
      )
    ).toBe(true);
  });

  it('logs unexpected pool errors instead of letting them surface as unhandled errors', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = Object.assign(new Error('connection lost unexpectedly'), { code: '08006' });

    handlePgPoolError(error);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[v2-adapter-db-postgres-pg] Unexpected idle pg pool error',
      error
    );
  });
  it('does not end a borrowed pool when the Kysely handle is destroyed', async () => {
    const end = vi.fn().mockResolvedValue(undefined);
    const pool = { connect: vi.fn(), end } as unknown as Pool;
    const db = await createV2PostgresDb(
      { pg: { connectionString: 'postgresql://teable:secret@db.example.com/teable' } },
      { pool }
    );

    await db.destroy();

    expect(end).not.toHaveBeenCalled();
  });
});
