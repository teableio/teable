import type { ILogger } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely';
import { describe, expect, it } from 'vitest';

import type { DynamicDB } from '../../../query-builder';
import { ComputedUpdateOutbox } from '../ComputedUpdateOutbox';
import { defaultComputedUpdateOutboxConfig } from '../IComputedUpdateOutbox';

class ClaimLockConnection implements DatabaseConnection {
  constructor(readonly queries: CompiledQuery[]) {}

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    this.queries.push(query);
    if (query.sql.includes('select "o"."base_id"')) {
      return { rows: [{ base_id: 'bse-test' }] as R[] };
    }
    if (query.sql.includes('pg_try_advisory_xact_lock')) {
      return { rows: [{ locked: false }] as R[] };
    }
    return { rows: [] };
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    yield { rows: [] };
  }
}

class ClaimLockDriver implements Driver {
  readonly queries: CompiledQuery[] = [];

  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    return new ClaimLockConnection(this.queries);
  }
  async beginTransaction(): Promise<void> {}
  async commitTransaction(): Promise<void> {}
  async rollbackTransaction(): Promise<void> {}
  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> {}
  async savepoint(): Promise<void> {}
  async rollbackToSavepoint(): Promise<void> {}
  async releaseSavepoint(): Promise<void> {}
}

const createLogger = (): ILogger => {
  const logger: ILogger = {
    child: () => logger,
    scope: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger;
};

describe('ComputedUpdateOutbox claimById', () => {
  it('returns immediately when the per-base claim lock is busy', async () => {
    const driver = new ClaimLockDriver();
    const db = new Kysely<DynamicDB>({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => driver,
        createIntrospector: (kysely) => new PostgresIntrospector(kysely),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
    });
    const outbox = new ComputedUpdateOutbox(
      db as unknown as Kysely<V1TeableDatabase>,
      defaultComputedUpdateOutboxConfig,
      createLogger(),
      db as unknown as Kysely<V1TeableDatabase>
    );

    const claimed = await outbox.claimById({ taskId: 'cuo-busy', workerId: 'queue-worker' });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()).toBeNull();
    expect(driver.queries.some((query) => query.sql.includes('pg_try_advisory_xact_lock'))).toBe(
      true
    );
    expect(driver.queries.some((query) => query.sql.includes('pg_advisory_xact_lock'))).toBe(false);
    expect(driver.queries).toHaveLength(2);
    await db.destroy();
  });
});
