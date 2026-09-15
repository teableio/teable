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

import type { DynamicDB } from '../record/query-builder';
import {
  ensureRowOrderColumnOnline,
  ensureRowOrderColumns,
  ROW_ORDER_ADVISORY_LOCK_NAMESPACE,
  ROW_ORDER_BACKFILL_CHUNK_SIZE,
  rowOrderIndexName,
} from './ensureRowOrderColumnOnline';

// =============================================================================
// Fake kysely driver that captures compiled SQL + parameters and tracks
// transaction boundaries (no real database needed).
// =============================================================================

type CapturedQuery = {
  sql: string;
  parameters: readonly unknown[];
  inTransaction: boolean;
};

type RowProvider = (compiledQuery: CompiledQuery) => unknown[];

class CapturingConnection implements DatabaseConnection {
  constructor(
    private readonly state: { queries: CapturedQuery[]; inTransaction: boolean },
    private readonly rowProvider: RowProvider
  ) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    this.state.queries.push({
      sql: compiledQuery.sql,
      parameters: compiledQuery.parameters,
      inTransaction: this.state.inTransaction,
    });
    return { rows: this.rowProvider(compiledQuery) as R[] };
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    yield { rows: [] };
  }
}

class CapturingDriver implements Driver {
  readonly state = { queries: [] as CapturedQuery[], inTransaction: false };

  constructor(private readonly rowProvider: RowProvider = () => []) {}

  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    return new CapturingConnection(this.state, this.rowProvider);
  }
  async beginTransaction(): Promise<void> {
    this.state.inTransaction = true;
  }
  async commitTransaction(): Promise<void> {
    this.state.inTransaction = false;
  }
  async rollbackTransaction(): Promise<void> {
    this.state.inTransaction = false;
  }
  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> {}
}

const createCapturingDb = (rowProvider?: RowProvider) => {
  const driver = new CapturingDriver(rowProvider);
  const db = new Kysely<DynamicDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { db, queries: driver.state.queries };
};

// =============================================================================
// Row providers
// =============================================================================

const REAL_PG_VERSION = 'PostgreSQL 16.4 on x86_64-pc-linux-gnu, compiled by gcc (Debian) 12.2.0';
const PGLITE_VERSION =
  'PostgreSQL 17.5 on aarch64-unknown-linux-gnu, compiled by emcc (Emscripten gcc/clang-like replacement) 3.1.74, 32-bit';

type HelperScenario = {
  columnExists?: boolean;
  minAutoNumber?: number | null;
  maxAutoNumber?: number | null;
  /** undefined = index does not exist; true/false = exists with indisvalid */
  indexValid?: boolean;
  version?: string;
};

const helperRowProvider =
  (scenario: HelperScenario): RowProvider =>
  (compiledQuery) => {
    const text = compiledQuery.sql;
    if (text.includes('information_schema.columns')) {
      return scenario.columnExists ? [{ column_name: '__row_viwX' }] : [];
    }
    if (text.includes('version()')) {
      return [{ version: scenario.version ?? REAL_PG_VERSION }];
    }
    if (text.includes('pg_try_advisory_lock')) {
      return [{ locked: true }];
    }
    if (text.includes('min(')) {
      return [
        {
          min_auto_number: scenario.minAutoNumber ?? null,
          max_auto_number: scenario.maxAutoNumber ?? null,
        },
      ];
    }
    if (text.includes('pg_stat_progress_create_index')) {
      return [{ in_progress: false }];
    }
    if (text.includes('pg_index')) {
      return scenario.indexValid === undefined ? [] : [{ indisvalid: scenario.indexValid }];
    }
    return [];
  };

// =============================================================================
// Tests
// =============================================================================

const TABLE = 'bse0000000000000aaaa.tbl0000000000000aaaa';
const VIEW_ID = 'viw0000000000000aaaa';
const INDEX_NAME = rowOrderIndexName(TABLE, VIEW_ID);
const ORDER_COLUMN = `__row_${VIEW_ID}`;

const isUpdate = (query: CapturedQuery) => query.sql.toLowerCase().includes('update');
const isChunkedBackfill = (query: CapturedQuery) =>
  isUpdate(query) && query.sql.includes('>=') && query.sql.includes('<');
const isStragglerSweep = (query: CapturedQuery) => isUpdate(query) && !isChunkedBackfill(query);

describe('ensureRowOrderColumnOnline', () => {
  it('short-circuits on the information_schema check when the column exists', async () => {
    const { db, queries } = createCapturingDb(helperRowProvider({ columnExists: true }));

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain('information_schema.columns');
  });

  it('takes a try-lock, unlocks before CIC, and uses the two-arg hashtext key', async () => {
    const { db, queries } = createCapturingDb(
      helperRowProvider({ minAutoNumber: null, maxAutoNumber: null })
    );

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    const lockIndex = queries.findIndex((query) => query.sql.includes('pg_try_advisory_lock'));
    const unlockIndex = queries.findIndex((query) => query.sql.includes('pg_advisory_unlock'));
    const createIndex = queries.findIndex((query) =>
      query.sql.toLowerCase().includes('create index')
    );
    expect(lockIndex).toBeGreaterThan(-1);
    expect(unlockIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeLessThan(unlockIndex);
    expect(unlockIndex).toBeLessThan(createIndex);
    expect(queries[lockIndex]!.parameters).toEqual([
      ROW_ORDER_ADVISORY_LOCK_NAMESPACE,
      `${TABLE}|${VIEW_ID}`,
    ]);
    expect(queries.some((query) => query.sql.includes('pg_advisory_lock('))).toBe(false);
    expect(queries[lockIndex]!.inTransaction).toBe(false);
    expect(queries[unlockIndex]!.inTransaction).toBe(false);
    expect(queries[createIndex]!.sql).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS');
    expect(queries[createIndex]!.inTransaction).toBe(false);
  });

  it('unlocks the advisory lock when creation fails', async () => {
    const failingProvider: RowProvider = (compiledQuery) => {
      if (compiledQuery.sql.toLowerCase().includes('alter table')) {
        throw Object.assign(new Error('canceling statement due to lock timeout'), {
          code: '55P03',
        });
      }
      return helperRowProvider({ minAutoNumber: null, maxAutoNumber: null })(compiledQuery);
    };
    const { db, queries } = createCapturingDb(failingProvider);

    await expect(ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME)).rejects.toThrow(
      /lock timeout/
    );
    expect(queries.some((query) => query.sql.includes('pg_advisory_unlock'))).toBe(true);
  });

  it('adds the column with IF NOT EXISTS inside a short transaction with lock_timeout', async () => {
    const { db, queries } = createCapturingDb(
      helperRowProvider({ minAutoNumber: null, maxAutoNumber: null })
    );

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    const lockTimeout = queries.find((query) => query.sql.includes('lock_timeout'));
    expect(lockTimeout).toBeDefined();
    expect(lockTimeout!.sql).toContain('SET LOCAL');
    expect(lockTimeout!.sql).toContain("'3s'");
    expect(lockTimeout!.inTransaction).toBe(true);

    const alter = queries.find((query) => query.sql.toLowerCase().includes('alter table'));
    expect(alter).toBeDefined();
    expect(alter!.sql.toLowerCase()).toContain('add column if not exists');
    expect(alter!.sql).toContain(`"${ORDER_COLUMN}"`);
    expect(alter!.sql).toContain('double precision');
    expect(alter!.inTransaction).toBe(true);

    // Nothing creation-related besides the fail-fast ALTER may run inside a
    // transaction: the chunked backfill and the CONCURRENTLY index DDL must be
    // autocommit statements on the non-transactional handle (T7251).
    const inTransactionSql = queries
      .filter((query) => query.inTransaction)
      .map((query) => query.sql.toLowerCase());
    expect(
      inTransactionSql.filter(
        (text) =>
          text.includes('update') || text.includes('create index') || text.includes('drop index')
      )
    ).toEqual([]);
  });

  it('backfills in __auto_number chunks with an IS NULL resume guard, then sweeps stragglers', async () => {
    const { db, queries } = createCapturingDb(
      helperRowProvider({
        minAutoNumber: 1,
        maxAutoNumber: ROW_ORDER_BACKFILL_CHUNK_SIZE * 2 + 2000,
      })
    );

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    const chunks = queries.filter(isChunkedBackfill);
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(chunk.sql).toContain('"__auto_number"');
      expect(chunk.sql.toLowerCase()).toContain('is null');
      expect(chunk.sql).toContain(`"${ORDER_COLUMN}"`);
      expect(chunk.inTransaction).toBe(false);
    }
    expect(chunks.map((chunk) => chunk.parameters)).toEqual([
      [1, 1 + ROW_ORDER_BACKFILL_CHUNK_SIZE],
      [1 + ROW_ORDER_BACKFILL_CHUNK_SIZE, 1 + ROW_ORDER_BACKFILL_CHUNK_SIZE * 2],
      [1 + ROW_ORDER_BACKFILL_CHUNK_SIZE * 2, 1 + ROW_ORDER_BACKFILL_CHUNK_SIZE * 3],
    ]);

    // One unconditional straggler sweep after the chunk loop catches rows
    // that committed after the min/max snapshot.
    const sweeps = queries.filter(isStragglerSweep);
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]!.sql.toLowerCase()).toContain('is null');
    expect(sweeps[0]!.parameters).toEqual([]);
    expect(sweeps[0]!.inTransaction).toBe(false);
    expect(queries.indexOf(sweeps[0]!)).toBeGreaterThan(queries.indexOf(chunks[2]!));
  });

  it('skips the chunk loop for empty tables but still sweeps', async () => {
    const { db, queries } = createCapturingDb(
      helperRowProvider({ minAutoNumber: null, maxAutoNumber: null })
    );

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    expect(queries.filter(isChunkedBackfill)).toEqual([]);
    expect(queries.filter(isStragglerSweep)).toHaveLength(1);
  });

  it('drops an invalid leftover index before unlock, then CREATE INDEX CONCURRENTLY', async () => {
    const { db, queries } = createCapturingDb(
      helperRowProvider({ minAutoNumber: null, maxAutoNumber: null, indexValid: false })
    );

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    const dropIndex = queries.findIndex((query) => query.sql.toLowerCase().includes('drop index'));
    const unlockIndex = queries.findIndex((query) => query.sql.includes('pg_advisory_unlock'));
    const createIndex = queries.findIndex((query) =>
      query.sql.toLowerCase().includes('create index')
    );
    expect(dropIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(-1);
    expect(dropIndex).toBeLessThan(unlockIndex);
    expect(unlockIndex).toBeLessThan(createIndex);

    expect(queries[dropIndex]!.sql).toContain('DROP INDEX CONCURRENTLY IF EXISTS');
    expect(queries[dropIndex]!.inTransaction).toBe(false);
    expect(queries[createIndex]!.sql).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS');
    expect(queries[createIndex]!.sql).toContain(`"${INDEX_NAME}"`);
    expect(queries[createIndex]!.inTransaction).toBe(false);
  });

  it('keeps a valid existing index and still runs CREATE INDEX CONCURRENTLY IF NOT EXISTS', async () => {
    const { db, queries } = createCapturingDb(
      helperRowProvider({ minAutoNumber: null, maxAutoNumber: null, indexValid: true })
    );

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    expect(queries.filter((query) => query.sql.toLowerCase().includes('drop index'))).toEqual([]);
    const createIndex = queries.find((query) => query.sql.toLowerCase().includes('create index'));
    expect(createIndex!.sql).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS');
    expect(createIndex!.inTransaction).toBe(false);
  });

  it('falls back to plain index DDL on PGlite (no CONCURRENTLY support)', async () => {
    const { db, queries } = createCapturingDb(
      helperRowProvider({
        minAutoNumber: null,
        maxAutoNumber: null,
        indexValid: false,
        version: PGLITE_VERSION,
      })
    );

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    const ddl = queries.filter((query) => {
      const text = query.sql.toLowerCase();
      return text.includes('create index') || text.includes('drop index');
    });
    expect(ddl.length).toBeGreaterThan(0);
    expect(ddl.every((query) => !query.sql.includes('CONCURRENTLY'))).toBe(true);
  });

  it('skips CREATE INDEX CONCURRENTLY when the caller already has an open transaction', async () => {
    const { db, queries } = createCapturingDb(
      helperRowProvider({ minAutoNumber: null, maxAutoNumber: null })
    );

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME, {
      skipConcurrentIndex: true,
    });

    expect(queries.some((query) => query.sql.toLowerCase().includes('create index'))).toBe(false);
    expect(queries.some((query) => query.sql.toLowerCase().includes('drop index'))).toBe(false);
    expect(queries.some((query) => query.sql.toLowerCase().includes('alter table'))).toBe(true);
  });
  it('rejects a transactional handle', async () => {
    const { db } = createCapturingDb(helperRowProvider({ columnExists: true }));

    await db.transaction().execute(async (trx) => {
      await expect(
        ensureRowOrderColumnOnline(trx as unknown as Kysely<DynamicDB>, TABLE, VIEW_ID, INDEX_NAME)
      ).rejects.toThrow(/non-transactional/);
    });
  });
});

describe('ensureRowOrderColumns (transaction-aware dispatch)', () => {
  const dispatchRowProvider =
    (options: { columnExists: boolean; createdHere: boolean; version?: string }): RowProvider =>
    (compiledQuery) => {
      const text = compiledQuery.sql;
      if (text.includes('information_schema.columns')) {
        return options.columnExists ? [{ column_name: ORDER_COLUMN }] : [];
      }
      if (text.includes('version()')) {
        return [{ version: options.version ?? REAL_PG_VERSION }];
      }
      if (text.includes('to_regclass')) {
        return [{ created_here: options.createdHere }];
      }
      return [];
    };

  it('creates in-transaction when the table was created by the current transaction', async () => {
    const tx = createCapturingDb(dispatchRowProvider({ columnExists: false, createdHere: true }));
    const nonTx = createCapturingDb(() => {
      throw new Error('non-transactional handle must not be used for transaction-local tables');
    });

    await ensureRowOrderColumns(tx.db, nonTx.db, TABLE, [VIEW_ID]);

    const alter = tx.queries.find((query) => query.sql.toLowerCase().includes('alter table'));
    expect(alter).toBeDefined();
    expect(alter!.sql.toLowerCase()).toContain('add column if not exists');
    const createIndex = tx.queries.find((query) =>
      query.sql.toLowerCase().includes('create index')
    );
    expect(createIndex).toBeDefined();
    // In-transaction creation stays plain (no CONCURRENTLY, no lock_timeout tx).
    expect(createIndex!.sql).not.toContain('CONCURRENTLY');
    expect(tx.queries.some((query) => query.sql.includes('lock_timeout'))).toBe(false);
    expect(nonTx.queries).toHaveLength(0);
  });

  it('always creates in-transaction on PGlite, regardless of the xmin probe', async () => {
    const tx = createCapturingDb(
      dispatchRowProvider({ columnExists: false, createdHere: false, version: PGLITE_VERSION })
    );
    const nonTx = createCapturingDb(() => {
      throw new Error('non-transactional handle must not be used on PGlite');
    });

    await ensureRowOrderColumns(tx.db, nonTx.db, TABLE, [VIEW_ID]);

    // The xmin probe is skipped entirely on PGlite.
    expect(tx.queries.some((query) => query.sql.includes('to_regclass'))).toBe(false);
    const alter = tx.queries.find((query) => query.sql.toLowerCase().includes('alter table'));
    expect(alter).toBeDefined();
    expect(alter!.sql.toLowerCase()).toContain('add column if not exists');
    expect(nonTx.queries).toHaveLength(0);
  });

  it('creates online on the non-transactional handle for existing committed tables', async () => {
    const tx = createCapturingDb(dispatchRowProvider({ columnExists: false, createdHere: false }));
    const nonTx = createCapturingDb(
      helperRowProvider({ minAutoNumber: null, maxAutoNumber: null })
    );

    await ensureRowOrderColumns(tx.db, nonTx.db, TABLE, [VIEW_ID]);

    // The request handle only ran the cheap probes — no creation work.
    expect(tx.queries.map((query) => query.sql)).toEqual([
      expect.stringContaining('information_schema.columns'),
      expect.stringContaining('version()'),
      expect.stringContaining('to_regclass'),
    ]);

    // All creation work happened on the non-transactional handle.
    expect(nonTx.queries.some((query) => query.sql.toLowerCase().includes('alter table'))).toBe(
      true
    );
    const createIndex = nonTx.queries.find((query) =>
      query.sql.toLowerCase().includes('create index')
    );
    expect(createIndex!.sql).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS');
  });

  it('does not fall back to in-transaction creation on lock timeout', async () => {
    const tx = createCapturingDb(dispatchRowProvider({ columnExists: false, createdHere: false }));
    const lockTimeoutOnAlter: RowProvider = (compiledQuery) => {
      if (compiledQuery.sql.toLowerCase().includes('alter table')) {
        throw Object.assign(new Error('canceling statement due to lock timeout'), {
          code: '55P03',
        });
      }
      return helperRowProvider({ minAutoNumber: null, maxAutoNumber: null })(compiledQuery);
    };
    const nonTx = createCapturingDb(lockTimeoutOnAlter);

    await expect(ensureRowOrderColumns(tx.db, nonTx.db, TABLE, [VIEW_ID])).rejects.toThrow(
      /lock timeout/
    );
    expect(tx.queries.some((query) => query.sql.toLowerCase().includes('alter table'))).toBe(false);
  });

  it('rethrows non-lock errors from the online path', async () => {
    const tx = createCapturingDb(dispatchRowProvider({ columnExists: false, createdHere: false }));
    const boom: RowProvider = (compiledQuery) => {
      if (compiledQuery.sql.toLowerCase().includes('alter table')) {
        throw Object.assign(new Error('out of shared memory'), { code: '53200' });
      }
      return helperRowProvider({ minAutoNumber: null, maxAutoNumber: null })(compiledQuery);
    };
    const nonTx = createCapturingDb(boom);

    await expect(ensureRowOrderColumns(tx.db, nonTx.db, TABLE, [VIEW_ID])).rejects.toThrow(
      /out of shared memory/
    );
    expect(tx.queries.some((query) => query.sql.toLowerCase().includes('alter table'))).toBe(false);
  });

  it('dedupes view ids and skips the fast path when the column exists', async () => {
    const tx = createCapturingDb(dispatchRowProvider({ columnExists: true, createdHere: false }));
    const nonTx = createCapturingDb(helperRowProvider({}));

    await ensureRowOrderColumns(tx.db, nonTx.db, TABLE, [VIEW_ID, VIEW_ID, '']);

    expect(tx.queries).toHaveLength(1);
    expect(nonTx.queries).toHaveLength(0);
  });
});
