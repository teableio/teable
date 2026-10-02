import { PostgresUnitOfWorkTransaction } from '@teable/v2-adapter-db-postgres-shared';
import { ActorId } from '@teable/v2-core';
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
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DynamicDB } from '../record/query-builder';
import {
  clearRowOrderColumnHealthCache,
  ensureRowOrderColumnOnline,
  ensureRowOrderColumns,
  hasOpenDataTransaction,
  ROW_ORDER_ADVISORY_LOCK_NAMESPACE,
  ROW_ORDER_BACKFILL_CHUNK_SIZE,
  ROW_ORDER_HEALTH_CACHE_TTL_MS,
  ROW_ORDER_INDEX_ADVISORY_LOCK_NAMESPACE,
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

type RowProvider = (
  compiledQuery: CompiledQuery
) => unknown[] | { rows: unknown[]; numAffectedRows: bigint };

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
    const result = this.rowProvider(compiledQuery);
    return Array.isArray(result)
      ? { rows: result as R[] }
      : { rows: result.rows as R[], numAffectedRows: result.numAffectedRows };
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
  /** Column is missing on the fast path but published before the first lock-held check. */
  publishedAfterFastPath?: boolean;
  /** An interrupted run left the pending column behind. */
  pendingExists?: boolean;
  minAutoNumber?: number | null;
  maxAutoNumber?: number | null;
  /** undefined = index does not exist; true/false = exists with indisvalid */
  indexValid?: boolean;
  /** The published column still holds NULLs. */
  hasNullOrders?: boolean;
  version?: string;
};

const helperRowProvider = (scenario: HelperScenario): RowProvider => {
  let columnChecks = 0;
  return (compiledQuery) => {
    const text = compiledQuery.sql;
    if (text.includes('information_schema.columns')) {
      if (compiledQuery.parameters.some((value) => String(value).startsWith('__pending_'))) {
        return scenario.pendingExists ? [{ column_name: 'pending' }] : [];
      }
      columnChecks += 1;
      const exists =
        scenario.columnExists || (scenario.publishedAfterFastPath === true && columnChecks > 1);
      return exists ? [{ column_name: '__row_viwX' }] : [];
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
    if (text.includes('AS has_null')) {
      return [{ has_null: scenario.hasNullOrders === true }];
    }
    if (text.includes('pg_stat_progress_create_index')) {
      return [{ in_progress: false }];
    }
    if (text.includes('pg_index')) {
      return scenario.indexValid === undefined ? [] : [{ indisvalid: scenario.indexValid }];
    }
    return [];
  };
};

// =============================================================================
// Tests
// =============================================================================

const TABLE = 'bse0000000000000aaaa.tbl0000000000000aaaa';
const VIEW_ID = 'viw0000000000000aaaa';
const INDEX_NAME = rowOrderIndexName(TABLE, VIEW_ID);
const ORDER_COLUMN = `__row_${VIEW_ID}`;
const PENDING_COLUMN = `__pending_row_order_${VIEW_ID}`;

const isUpdate = (query: CapturedQuery) => query.sql.toLowerCase().includes('update');
const isRename = (query: CapturedQuery) => query.sql.toLowerCase().includes('rename column');
const isLockTable = (query: CapturedQuery) => query.sql.toLowerCase().includes('lock table');
const isCreateIndex = (query: CapturedQuery) => query.sql.toLowerCase().includes('create index');
const isChunkedBackfill = (query: CapturedQuery) =>
  isUpdate(query) && query.sql.includes('>=') && query.sql.includes('<');
const isStragglerSweep = (query: CapturedQuery) => isUpdate(query) && !isChunkedBackfill(query);

describe('ensureRowOrderColumnOnline', () => {
  beforeEach(() => {
    clearRowOrderColumnHealthCache();
  });

  it('short-circuits when the column and a valid index exist', async () => {
    const { db, queries } = createCapturingDb(
      helperRowProvider({ columnExists: true, indexValid: true })
    );

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    expect(queries[0]!.sql).toContain('information_schema.columns');
    expect(queries.some((query) => query.sql.includes('pg_try_advisory_lock'))).toBe(false);
    expect(queries.some(isCreateIndex)).toBe(false);
  });

  it('short-circuits on the column check alone inside a caller transaction', async () => {
    const { db, queries } = createCapturingDb(helperRowProvider({ columnExists: true }));

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME, {
      skipConcurrentIndex: true,
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain('information_schema.columns');
  });

  it('builds the missing index of a column published inside a caller transaction', async () => {
    const { db, queries } = createCapturingDb(helperRowProvider({ columnExists: true }));

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    const createIndex = queries.filter(isCreateIndex);
    expect(createIndex).toHaveLength(1);
    expect(createIndex[0]!.sql).toContain('CONCURRENTLY');
    expect(createIndex[0]!.sql).toContain(`"${ORDER_COLUMN}"`);
    const lock = queries.find((query) => query.sql.includes('pg_try_advisory_lock'));
    expect(lock?.parameters).toEqual([ROW_ORDER_INDEX_ADVISORY_LOCK_NAMESPACE, TABLE]);
    expect(queries.some((query) => query.sql.toLowerCase().includes('alter table'))).toBe(false);
    expect(queries.some(isUpdate)).toBe(false);
  });

  it('rebuilds an idle invalid index of a published column', async () => {
    const { db, queries } = createCapturingDb(
      helperRowProvider({ columnExists: true, indexValid: false })
    );

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    const dropAt = queries.findIndex((query) => query.sql.includes('DROP INDEX CONCURRENTLY'));
    const createAt = queries.findIndex(isCreateIndex);
    expect(dropAt).toBeGreaterThanOrEqual(0);
    expect(createAt).toBeGreaterThan(dropAt);
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

  it('adds the pending column with IF NOT EXISTS inside a short transaction with lock_timeout', async () => {
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
    expect(alter!.sql).toContain(`"${PENDING_COLUMN}"`);
    expect(alter!.sql).not.toContain(`"${ORDER_COLUMN}"`);
    expect(alter!.sql).toContain('double precision');
    expect(alter!.inTransaction).toBe(true);

    // The chunked backfill and the CONCURRENTLY index DDL must be autocommit
    // statements on the non-transactional handle (T7251). Only the publish
    // sweep and rename run in a transaction.
    const inTransaction = queries.filter((query) => query.inTransaction);
    expect(inTransaction.filter(isChunkedBackfill)).toEqual([]);
    expect(
      inTransaction.filter((query) => {
        const text = query.sql.toLowerCase();
        return text.includes('create index') || text.includes('drop index');
      })
    ).toEqual([]);
  });

  it('never exposes __row_<viewId> before the backfill is complete', async () => {
    const { db, queries } = createCapturingDb(
      helperRowProvider({ minAutoNumber: 1, maxAutoNumber: ROW_ORDER_BACKFILL_CHUNK_SIZE + 10 })
    );

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    const rename = queries.find(isRename);
    expect(rename).toBeDefined();
    expect(rename!.sql).toContain(`"${PENDING_COLUMN}" TO "${ORDER_COLUMN}"`);
    expect(rename!.inTransaction).toBe(true);

    const renameIndex = queries.indexOf(rename!);
    const beforeRename = queries.slice(0, renameIndex);
    // Before the rename nothing writes or indexes the published column name.
    expect(
      beforeRename.filter(
        (query) =>
          (isUpdate(query) || isCreateIndex(query) || query.sql.includes('ALTER TABLE')) &&
          query.sql.includes(`"${ORDER_COLUMN}"`) &&
          !isRename(query)
      )
    ).toEqual([]);

    // Publish = LOCK TABLE → sweep pending NULLs → rename, in one transaction
    // after the index was built on the pending column.
    const lockTable = queries.find(isLockTable);
    expect(lockTable).toBeDefined();
    expect(lockTable!.sql).toContain('IN ACCESS EXCLUSIVE MODE');
    expect(lockTable!.inTransaction).toBe(true);
    const publishSweep = queries[renameIndex - 1]!;
    expect(isStragglerSweep(publishSweep)).toBe(true);
    expect(publishSweep.sql).toContain(`"${PENDING_COLUMN}"`);
    expect(publishSweep.inTransaction).toBe(true);
    expect(queries.indexOf(lockTable!)).toBeLessThan(queries.indexOf(publishSweep));
    expect(queries[renameIndex - 3]!.sql).toContain('lock_timeout');

    const createIndex = queries.find(isCreateIndex);
    expect(createIndex!.sql).toContain(`("${PENDING_COLUMN}")`);
    expect(queries.indexOf(createIndex!)).toBeLessThan(queries.indexOf(lockTable!));

    // Creation lock (ADD under the table DDL lock) → table lock around CIC →
    // creation lock again for the publish, also under the table DDL lock.
    const locks = queries.filter((query) => query.sql.includes('pg_try_advisory_lock'));
    const unlocks = queries.filter((query) => query.sql.includes('pg_advisory_unlock'));
    const creationLock = [ROW_ORDER_ADVISORY_LOCK_NAMESPACE, `${TABLE}|${VIEW_ID}`];
    const tableLock = [ROW_ORDER_INDEX_ADVISORY_LOCK_NAMESPACE, TABLE];
    expect(locks.map((query) => query.parameters)).toEqual([
      creationLock,
      tableLock,
      tableLock,
      creationLock,
      tableLock,
    ]);
    expect(unlocks.map((query) => query.parameters)).toEqual([
      tableLock,
      creationLock,
      tableLock,
      tableLock,
      creationLock,
    ]);
    const at = (query: CapturedQuery) => queries.indexOf(query);
    const addColumnAt = queries.findIndex((query) => query.sql.includes('ADD COLUMN'));
    const createIndexAt = at(createIndex!);
    expect(at(locks[1]!)).toBeLessThan(addColumnAt);
    expect(at(unlocks[0]!)).toBeGreaterThan(addColumnAt);
    expect(at(unlocks[1]!)).toBeLessThan(at(locks[2]!));
    expect(at(locks[2]!)).toBeLessThan(createIndexAt);
    expect(at(unlocks[2]!)).toBeGreaterThan(createIndexAt);
    expect(at(locks[4]!)).toBeLessThan(at(lockTable!));
    expect(at(unlocks[3]!)).toBeGreaterThan(renameIndex);
    expect(at(unlocks[4]!)).toBeGreaterThan(at(unlocks[3]!));
  });

  it('backfills NULLs left in a published column by a pre-T7570 publish', async () => {
    const { db, queries } = createCapturingDb(
      helperRowProvider({
        columnExists: true,
        indexValid: true,
        hasNullOrders: true,
        minAutoNumber: 1,
        maxAutoNumber: 10,
      })
    );

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    const lock = queries.find((query) => query.sql.includes('pg_try_advisory_lock'));
    expect(lock?.parameters).toEqual([ROW_ORDER_ADVISORY_LOCK_NAMESPACE, `${TABLE}|${VIEW_ID}`]);
    const updates = queries.filter(isUpdate);
    expect(updates.length).toBeGreaterThan(1);
    expect(updates.every((query) => query.sql.includes(`"${ORDER_COLUMN}" IS NULL`))).toBe(true);
    // The highest NULL row is filled before the chunks, so appends that read
    // MAX afterwards land after every value the chunks write.
    expect(updates[0]!.sql).toContain('max("__auto_number")');
    expect(updates.slice(1).every((query) => !query.sql.includes('max('))).toBe(true);
    expect(updates.every((query) => !query.inTransaction)).toBe(true);
    expect(queries.some((query) => query.sql.includes('ALTER TABLE'))).toBe(false);
  });

  it('resumes an interrupted run without re-issuing ALTER on the pending column', async () => {
    const { db, queries } = createCapturingDb(
      helperRowProvider({ pendingExists: true, minAutoNumber: 1, maxAutoNumber: 10 })
    );

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    // IF NOT EXISTS would still queue for AccessExclusive behind a live CIC.
    expect(queries.some((query) => query.sql.toLowerCase().includes('add column'))).toBe(false);
    expect(queries.filter(isChunkedBackfill)).toHaveLength(1);
    expect(queries.some(isRename)).toBe(true);
  });

  it('skips creation and rename when another session published after the fast path', async () => {
    const { db, queries } = createCapturingDb(
      helperRowProvider({ publishedAfterFastPath: true, minAutoNumber: 1, maxAutoNumber: 10 })
    );

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    expect(queries.some((query) => query.sql.toLowerCase().includes('alter table'))).toBe(false);
    expect(queries.filter(isUpdate)).toEqual([]);
    const createIndex = queries.find(isCreateIndex);
    expect(createIndex!.sql).toContain(`("${ORDER_COLUMN}")`);
  });

  it('tolerates the pending column being published while its CIC starts', async () => {
    const provider = helperRowProvider({ minAutoNumber: null, maxAutoNumber: null });
    const { db, queries } = createCapturingDb((compiledQuery) => {
      if (compiledQuery.sql.includes('CREATE INDEX CONCURRENTLY')) {
        throw Object.assign(new Error(`column "${PENDING_COLUMN}" does not exist`), {
          code: '42703',
        });
      }
      return provider(compiledQuery);
    });

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    expect(queries.some(isRename)).toBe(true);
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
      expect(chunk.sql).toContain(`"${PENDING_COLUMN}"`);
      expect(chunk.inTransaction).toBe(false);
    }
    expect(chunks.map((chunk) => chunk.parameters)).toEqual([
      [1, 1 + ROW_ORDER_BACKFILL_CHUNK_SIZE],
      [1 + ROW_ORDER_BACKFILL_CHUNK_SIZE, 1 + ROW_ORDER_BACKFILL_CHUNK_SIZE * 2],
      [1 + ROW_ORDER_BACKFILL_CHUNK_SIZE * 2, 1 + ROW_ORDER_BACKFILL_CHUNK_SIZE * 3],
    ]);

    // Autocommit straggler sweeps after the chunk loop and again after the
    // CIC keep the publish sweep under LOCK TABLE down to the last few rows.
    const sweeps = queries.filter(isStragglerSweep);
    expect(sweeps).toHaveLength(3);
    for (const sweep of sweeps) {
      expect(sweep.sql.toLowerCase()).toContain('is null');
      expect(sweep.sql).toContain(`"${PENDING_COLUMN}"`);
      expect(sweep.parameters).toEqual([]);
    }
    expect(sweeps[0]!.inTransaction).toBe(false);
    expect(queries.indexOf(sweeps[0]!)).toBeGreaterThan(queries.indexOf(chunks[2]!));
    const createIndexAt = queries.findIndex(isCreateIndex);
    const lockTableAt = queries.findIndex(isLockTable);
    expect(sweeps[1]!.inTransaction).toBe(false);
    expect(queries.indexOf(sweeps[1]!)).toBeGreaterThan(createIndexAt);
    expect(queries.indexOf(sweeps[1]!)).toBeLessThan(lockTableAt);
    expect(sweeps[2]!.inTransaction).toBe(true);
  });

  it('skips the chunk loop for empty tables but still sweeps', async () => {
    const { db, queries } = createCapturingDb(
      helperRowProvider({ minAutoNumber: null, maxAutoNumber: null })
    );

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    expect(queries.filter(isChunkedBackfill)).toEqual([]);
    expect(queries.filter(isStragglerSweep)).toHaveLength(3);
  });

  it('drops an invalid leftover index under the index lock, right before CREATE INDEX CONCURRENTLY', async () => {
    const { db, queries } = createCapturingDb(
      helperRowProvider({ minAutoNumber: null, maxAutoNumber: null, indexValid: false })
    );

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    const dropIndex = queries.findIndex((query) => query.sql.toLowerCase().includes('drop index'));
    const createIndex = queries.findIndex((query) =>
      query.sql.toLowerCase().includes('create index')
    );
    const indexLockBeforeDrop = queries
      .slice(0, dropIndex)
      .filter(
        (query) =>
          query.sql.includes('pg_try_advisory_lock') &&
          query.parameters[0] === ROW_ORDER_INDEX_ADVISORY_LOCK_NAMESPACE
      );
    const indexUnlockBetween = queries
      .slice(dropIndex, createIndex)
      .filter((query) => query.sql.includes('pg_advisory_unlock'));
    expect(dropIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(dropIndex);
    expect(indexLockBeforeDrop.length).toBeGreaterThan(0);
    expect(indexUnlockBetween).toEqual([]);

    expect(queries[dropIndex]!.sql).toContain('DROP INDEX CONCURRENTLY IF EXISTS');
    expect(queries[dropIndex]!.inTransaction).toBe(false);
    expect(queries[createIndex]!.sql).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS');
    expect(queries[createIndex]!.sql).toContain(`"${INDEX_NAME}"`);
    expect(queries[createIndex]!.inTransaction).toBe(false);
  });

  it('retries the highest-NULL fill when a concurrent write makes it hit no row', async () => {
    const base = helperRowProvider({
      columnExists: true,
      indexValid: true,
      hasNullOrders: true,
      minAutoNumber: 1,
      maxAutoNumber: 10,
    });
    const affected = [BigInt(0), BigInt(0), BigInt(1)];
    const { db, queries } = createCapturingDb((compiledQuery) => {
      const text = compiledQuery.sql;
      if (text.includes('max("__auto_number")') && text.toLowerCase().includes('update')) {
        return { rows: [], numAffectedRows: affected.shift() ?? BigInt(1) };
      }
      return base(compiledQuery);
    });

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    const topFills = queries.filter(
      (query) => isUpdate(query) && query.sql.includes('max("__auto_number")')
    );
    expect(topFills).toHaveLength(3);
    expect(queries.filter(isChunkedBackfill).length).toBeGreaterThan(0);
  });

  it('tolerates a concurrent build of the same index name (42P07)', async () => {
    const base = helperRowProvider({ minAutoNumber: null, maxAutoNumber: null });
    const { db, queries } = createCapturingDb((compiledQuery) => {
      if (compiledQuery.sql.includes('CREATE INDEX CONCURRENTLY')) {
        throw Object.assign(new Error('relation already exists'), { code: '42P07' });
      }
      return base(compiledQuery);
    });

    await ensureRowOrderColumnOnline(db, TABLE, VIEW_ID, INDEX_NAME);

    expect(queries.some(isRename)).toBe(true);
  });

  it('skips the health probes once a published column was verified, until the TTL expires', async () => {
    vi.useFakeTimers();
    try {
      const provider = helperRowProvider({ columnExists: true, indexValid: true });
      const first = createCapturingDb(provider);
      await ensureRowOrderColumnOnline(first.db, TABLE, VIEW_ID, INDEX_NAME);
      expect(first.queries.some((query) => query.sql.includes('AS has_null'))).toBe(true);

      const second = createCapturingDb(provider);
      await ensureRowOrderColumnOnline(second.db, TABLE, VIEW_ID, INDEX_NAME);
      expect(second.queries).toHaveLength(1);
      expect(second.queries[0]!.sql).toContain('information_schema.columns');

      vi.advanceTimersByTime(ROW_ORDER_HEALTH_CACHE_TTL_MS + 1);
      const third = createCapturingDb(provider);
      await ensureRowOrderColumnOnline(third.db, TABLE, VIEW_ID, INDEX_NAME);
      expect(third.queries.some((query) => query.sql.includes('AS has_null'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('detects an open data transaction carried by the execution context', async () => {
    const { db } = createCapturingDb();
    const actorId = ActorId.create('system')._unsafeUnwrap();

    expect(hasOpenDataTransaction(db, { actorId })).toBe(false);
    await db.transaction().execute(async (trx) => {
      const dataTransaction = new PostgresUnitOfWorkTransaction(trx as never, 'data');
      expect(hasOpenDataTransaction(db, { actorId, transaction: dataTransaction })).toBe(true);
      const metaTransaction = new PostgresUnitOfWorkTransaction(trx as never, 'meta');
      expect(hasOpenDataTransaction(db, { actorId, transaction: metaTransaction })).toBe(false);
    });
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
    expect(queries.some(isRename)).toBe(true);
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
  beforeEach(() => {
    clearRowOrderColumnHealthCache();
  });

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
    // Mixed-case schema/table names must be quoted, or to_regclass misses
    // the table and every table reads as created by this transaction.
    expect(tx.queries[2]!.sql).toContain(`to_regclass(quote_ident($1) || '.' || quote_ident($2))`);
    expect(tx.queries[2]!.parameters).toEqual(TABLE.split('.'));

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

  it('dedupes view ids and skips an existing column inside a caller transaction', async () => {
    const tx = createCapturingDb(dispatchRowProvider({ columnExists: true, createdHere: false }));
    const nonTx = createCapturingDb(helperRowProvider({}));

    await tx.db.transaction().execute(async (trx) => {
      await ensureRowOrderColumns(trx as unknown as Kysely<DynamicDB>, nonTx.db, TABLE, [
        VIEW_ID,
        VIEW_ID,
        '',
      ]);
    });

    expect(tx.queries).toHaveLength(1);
    expect(nonTx.queries).toHaveLength(0);
  });

  it('heals the missing index of an existing column outside a transaction', async () => {
    const tx = createCapturingDb(dispatchRowProvider({ columnExists: true, createdHere: false }));
    const nonTx = createCapturingDb(helperRowProvider({ columnExists: true }));

    await ensureRowOrderColumns(tx.db, nonTx.db, TABLE, [VIEW_ID]);

    expect(nonTx.queries.filter(isCreateIndex)).toHaveLength(1);
  });
});
