import { PGlite } from '@electric-sql/pglite';
import type { Dialect, QueryResult } from 'kysely';
import {
  CompiledQuery,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import {
  buildAdvisoryLockBatchQuery,
  buildSharedAdvisoryLockQuery,
  buildTryAdvisoryLockBatchQuery,
  buildTrySharedAdvisoryLockQuery,
} from '../ComputedUpdateLock';

class PGliteDriver {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  async init() {}

  async acquireConnection() {
    return new PGliteConnection(this.#client);
  }

  async beginTransaction(connection: PGliteConnection) {
    await connection.executeQuery(CompiledQuery.raw('BEGIN'));
  }

  async commitTransaction(connection: PGliteConnection) {
    await connection.executeQuery(CompiledQuery.raw('COMMIT'));
  }

  async rollbackTransaction(connection: PGliteConnection) {
    await connection.executeQuery(CompiledQuery.raw('ROLLBACK'));
  }

  async releaseConnection() {}

  async destroy() {}
}

class PGliteConnection {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  async executeQuery<O>(compiledQuery: CompiledQuery): Promise<QueryResult<O>> {
    const result = await this.#client.query<O>(compiledQuery.sql, [...compiledQuery.parameters]);
    return {
      numAffectedRows: result.affectedRows ? BigInt(result.affectedRows) : undefined,
      rows: result.rows as O[],
    };
  }

  async *streamQuery(): AsyncGenerator<never, void, unknown> {
    yield undefined as never;
    throw new Error('Streaming not supported');
  }
}

class PGliteDialect implements Dialect {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  createDriver() {
    return new PGliteDriver(this.#client);
  }

  createAdapter() {
    return new PostgresAdapter();
  }

  createIntrospector(db: Kysely<unknown>) {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }
}

describe('ComputedUpdateLock batch queries (pglite integration)', () => {
  let pglite: PGlite;
  let db: Kysely<unknown>;

  beforeAll(async () => {
    pglite = await PGlite.create();
    db = new Kysely({ dialect: new PGliteDialect(pglite) });
  });

  afterAll(async () => {
    await db.destroy();
    await pglite.close();
  });

  const keys = [
    'v2:computed:tblbatch:recAaa',
    'v2:computed:tblbatch:recBbb',
    'v2:computed:tblbatch:batch:03',
    'v2:computed:tblbatch',
  ];

  it('acquires every key in one blocking round trip', async () => {
    await db.transaction().execute(async (trx) => {
      const result = await trx.executeQuery(buildAdvisoryLockBatchQuery(trx, keys));
      expect(result.rows).toHaveLength(keys.length);
    });
  });

  it('reports per-key results for the try variant', async () => {
    await db.transaction().execute(async (trx) => {
      const result = await trx.executeQuery(buildTryAdvisoryLockBatchQuery(trx, keys));
      expect(result.rows.map((row) => row.key)).toEqual(keys);
      expect(result.rows.every((row) => row.locked)).toBe(true);
    });
  });

  it('stays reentrant when the same transaction already holds a key', async () => {
    await db.transaction().execute(async (trx) => {
      await trx.executeQuery(buildAdvisoryLockBatchQuery(trx, [keys[0]!]));
      const result = await trx.executeQuery(buildTryAdvisoryLockBatchQuery(trx, keys));
      expect(result.rows.every((row) => row.locked)).toBe(true);
    });
  });

  it('acquires a shared covering lock without taking the exclusive table key', async () => {
    const tableKey = 'v2:computed:tblbatch';
    await db.transaction().execute(async (trx) => {
      const held = await trx.executeQuery(buildSharedAdvisoryLockQuery(trx, tableKey));
      expect(held.rows).toHaveLength(1);
      const retried = await trx.executeQuery(buildTrySharedAdvisoryLockQuery(trx, tableKey));
      expect(retried.rows[0]?.locked).toBe(true);
    });
  });
});
