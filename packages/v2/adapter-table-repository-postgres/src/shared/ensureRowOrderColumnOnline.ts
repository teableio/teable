import { resolvePostgresDbOrTx } from '@teable/v2-adapter-db-postgres-shared';
import type { IExecutionContext } from '@teable/v2-core';
import { sql, type Kysely, type Transaction } from 'kysely';

import type { DynamicDB } from '../record/query-builder';
import { splitSchemaQualifiedTableName, toPostgresIdentifierWithHash } from './sqlIdentifiers';

/**
 * T7251: Lazily created `__row_<viewId>` row-order columns must never be
 * created inside the caller's DB transaction. The pre-fix code ran
 * `ALTER TABLE ADD COLUMN` (AccessExclusiveLock, held until commit) plus a
 * full-table backfill `UPDATE` and a plain `CREATE INDEX` on the request
 * transaction — blocking every other session (CN prod incident 2026-09-09).
 *
 * Every reader (v1 and v2) treats an existing `__row_<viewId>` column as
 * fully backfilled and falls back to `__auto_number` while it is missing, so
 * the column only becomes visible once every row has a value (T7570). The
 * backfill fills `__pending_row_order_<viewId>` instead and is published by
 * rename:
 *  1. information_schema fast path when the column already exists. A column
 *     published by a caller inside a transaction has no index (step 5 is
 *     skipped there), so callers without one build it via CIC, and NULLs
 *     left by pre-T7570 publishes are backfilled.
 *  2. `pg_try_advisory_lock(hashtext(ns), hashtext(key))` on a pinned
 *     connection. Losers poll try-lock (no blocking lock waiter — CIC in
 *     the holder deadlocks with those, prisma-engines#5755 /
 *     community/scripts/postgres-migrate-lock.mjs).
 *  3. `ADD COLUMN IF NOT EXISTS` of the pending column in a short
 *     transaction with 3s `lock_timeout`, under the per-table index lock of
 *     step 5 (like step 6). Failure is raised to the caller —
 *     never folded back into the request transaction (that re-arms
 *     AccessExclusive).
 *  4. Chunked autocommit backfill (`IS NULL` resume) + straggler sweep. An
 *     interrupted run leaves only the pending column, which the next call
 *     resumes.
 *  5. Unlock, then `CREATE INDEX CONCURRENTLY IF NOT EXISTS` on the pending
 *     column under a separate per-table try-lock. Invalid leftovers are
 *     dropped only when `pg_stat_progress_create_index` shows no live build.
 *     CIC never runs while the creation lock is held, and is skipped when
 *     the caller already has an open transaction (CIC waits for that
 *     snapshot → self-deadlock).
 *  6. Re-lock, then in one short transaction: `LOCK TABLE` (3s
 *     `lock_timeout`), sweep rows inserted since step 4, and rename the
 *     pending column to `__row_<viewId>`. Inserts never see the pending
 *     column, so they cannot derive an order from a partial MAX.
 */

export const ROW_ORDER_BACKFILL_CHUNK_SIZE = 5000;
export const ROW_ORDER_ADVISORY_LOCK_NAMESPACE = 'teable.row_order_column';
export const ROW_ORDER_INDEX_ADVISORY_LOCK_NAMESPACE = 'teable.row_order_index';
export const ROW_ORDER_ADVISORY_LOCK_WAIT_MS = 120_000;
export const ROW_ORDER_ADVISORY_LOCK_POLL_MS = 50;

const AUTO_NUMBER_COLUMN = '__auto_number';
const ROW_ORDER_COLUMN_LOCK_TIMEOUT = '3s';

export const rowOrderColumnNameForView = (viewId: string): string => `__row_${viewId}`;

/** Must not start with `__row`: v1 and duplicate/import code treat those as published. */
export const PENDING_ROW_ORDER_COLUMN_PREFIX = '__pending_row_order_';

export const pendingRowOrderColumnNameForView = (viewId: string): string =>
  `${PENDING_ROW_ORDER_COLUMN_PREFIX}${viewId}`;

/** Default index name used by the record repository / order calculator. */
export const rowOrderIndexName = (tableName: string, viewId: string): string => {
  const { plainTableName } = splitSchemaQualifiedTableName(tableName);
  return toPostgresIdentifierWithHash(`idx_${plainTableName}_${rowOrderColumnNameForView(viewId)}`);
};

const isTruthySqlFlag = (value: unknown): boolean => value === true || value === 't';

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

/** information_schema fast path; cheap and lock-free on any handle. */
const rowOrderColumnExists = async (
  db: Kysely<DynamicDB>,
  tableName: string,
  orderColumnName: string
): Promise<boolean> => {
  const { schemaName, plainTableName } = splitSchemaQualifiedTableName(tableName);
  const result = await sql<{ column_name: string }>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = ${schemaName ?? 'public'}
    AND table_name = ${plainTableName}
    AND column_name = ${orderColumnName}
  `.execute(db);

  return result.rows.length > 0;
};

/**
 * True when `tableName` was created by the current transaction on `txDb`.
 * Such tables are invisible to other connections, so column creation must
 * stay in-transaction.
 */
const tableCreatedInCurrentTransaction = async (
  txDb: Kysely<DynamicDB>,
  tableName: string
): Promise<boolean> => {
  const { schemaName, plainTableName } = splitSchemaQualifiedTableName(tableName);
  // Quote each part: an unquoted mixed-case name folds to lower case and
  // to_regclass returns NULL, which would read as "created here".
  const qualifiedName = schemaName
    ? sql`quote_ident(${schemaName}) || '.' || quote_ident(${plainTableName})`
    : sql`quote_ident(${plainTableName})`;
  const result = await sql<{ created_here: boolean }>`
    SELECT (c.xmin = (txid_current() % 4294967296)::text::xid) AS created_here
    FROM pg_class c
    WHERE c.oid = to_regclass(${qualifiedName})
  `.execute(txDb);

  return result.rows[0]?.created_here ?? true;
};

const isPgliteEngine = async (db: Kysely<DynamicDB>): Promise<boolean> => {
  const result = await sql<{ version: string }>`SELECT version()`.execute(db);
  const version = result.rows[0]?.version ?? '';
  return /pglite|emscripten|emcc/i.test(version);
};

const isOpenTransaction = (db: Kysely<DynamicDB>): boolean =>
  (db as Transaction<DynamicDB>).isTransaction === true;

/** Legacy in-transaction creation for tables created by the current transaction. */
const createRowOrderColumnInTransaction = async (
  txDb: Kysely<DynamicDB>,
  tableName: string,
  viewId: string,
  indexName: string
): Promise<void> => {
  const orderColumnName = rowOrderColumnNameForView(viewId);
  await sql`
    ALTER TABLE ${sql.table(tableName)}
    ADD COLUMN IF NOT EXISTS ${sql.id(orderColumnName)} double precision
  `.execute(txDb);

  await sql`
    UPDATE ${sql.table(tableName)}
    SET ${sql.id(orderColumnName)} = ${sql.id(AUTO_NUMBER_COLUMN)}
    WHERE ${sql.id(orderColumnName)} IS NULL
  `.execute(txDb);

  await sql`
    CREATE INDEX IF NOT EXISTS ${sql.id(indexName)}
    ON ${sql.table(tableName)} (${sql.id(orderColumnName)})
  `.execute(txDb);
};

const acquireRowOrderAdvisoryLock = async (
  conn: Kysely<DynamicDB>,
  advisoryLockKey: string,
  namespace: string
): Promise<void> => {
  const deadline = Date.now() + ROW_ORDER_ADVISORY_LOCK_WAIT_MS;
  for (;;) {
    const lockResult = await sql<{ locked: boolean | string }>`
      SELECT pg_try_advisory_lock(
        hashtext(${namespace}),
        hashtext(${advisoryLockKey})
      ) AS locked
    `.execute(conn);
    if (isTruthySqlFlag(lockResult.rows[0]?.locked)) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        'timed out waiting to create row-order column (T7251): another session still holds the creation lock'
      );
    }
    await sleep(ROW_ORDER_ADVISORY_LOCK_POLL_MS);
  }
};

const indexBuildInProgress = async (
  conn: Kysely<DynamicDB>,
  schema: string,
  indexName: string
): Promise<boolean> => {
  const result = await sql<{ in_progress: boolean | string }>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_stat_progress_create_index p
      JOIN pg_class idx ON idx.oid = p.index_relid
      JOIN pg_namespace n ON n.oid = idx.relnamespace
      WHERE idx.relname = ${indexName}
        AND n.nspname = ${schema}
    ) AS in_progress
  `.execute(conn);
  return isTruthySqlFlag(result.rows[0]?.in_progress);
};

const readIndexValidity = async (
  conn: Kysely<DynamicDB>,
  schema: string,
  indexName: string
): Promise<boolean | undefined> => {
  const result = await sql<{ indisvalid: boolean }>`
    SELECT i.indisvalid
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = ${indexName}
      AND n.nspname = ${schema}
  `.execute(conn);
  return result.rows[0]?.indisvalid;
};

const dropIdleInvalidIndex = async (
  conn: Kysely<DynamicDB>,
  schema: string,
  indexName: string
): Promise<void> => {
  if (await indexBuildInProgress(conn, schema, indexName)) {
    return;
  }
  if ((await readIndexValidity(conn, schema, indexName)) === false) {
    await sql`DROP INDEX CONCURRENTLY IF EXISTS ${sql.id(schema, indexName)}`.execute(conn);
  }
};

const withRowOrderAdvisoryLock = async <T>(
  nonTxDb: Kysely<DynamicDB>,
  advisoryLockKey: string,
  run: (conn: Kysely<DynamicDB>) => Promise<T>,
  namespace: string = ROW_ORDER_ADVISORY_LOCK_NAMESPACE
): Promise<T> =>
  nonTxDb.connection().execute(async (conn) => {
    await acquireRowOrderAdvisoryLock(conn, advisoryLockKey, namespace);
    try {
      return await run(conn);
    } finally {
      await sql`
        SELECT pg_advisory_unlock(
          hashtext(${namespace}),
          hashtext(${advisoryLockKey})
        )
      `.execute(conn);
    }
  });

/**
 * ADD COLUMN and the publish take ACCESS EXCLUSIVE, which queues behind a
 * CIC of another view on the same table and blocks every session meanwhile.
 * Waiting on the index lock instead keeps them out of the lock queue.
 */
const withTableDdlLock = async <T>(
  conn: Kysely<DynamicDB>,
  tableName: string,
  run: () => Promise<T>
): Promise<T> => {
  await acquireRowOrderAdvisoryLock(conn, tableName, ROW_ORDER_INDEX_ADVISORY_LOCK_NAMESPACE);
  try {
    return await run();
  } finally {
    await sql`
      SELECT pg_advisory_unlock(
        hashtext(${ROW_ORDER_INDEX_ADVISORY_LOCK_NAMESPACE}),
        hashtext(${tableName})
      )
    `.execute(conn);
  }
};

const hasNullRowOrder = async (
  db: Kysely<DynamicDB>,
  tableName: string,
  columnName: string
): Promise<boolean> => {
  const result = await sql<{ has_null: boolean | string }>`
    SELECT EXISTS (
      SELECT 1 FROM ${sql.table(tableName)} WHERE ${sql.id(columnName)} IS NULL
    ) AS has_null
  `.execute(db);
  return isTruthySqlFlag(result.rows[0]?.has_null);
};

/** Chunked autocommit `column = __auto_number` backfill; `IS NULL` makes it resumable. */
const backfillFromAutoNumber = async (
  conn: Kysely<DynamicDB>,
  tableName: string,
  columnName: string
): Promise<void> => {
  const bounds = await sql<{ min_auto_number: number | null; max_auto_number: number | null }>`
    SELECT min(${sql.id(AUTO_NUMBER_COLUMN)}) AS min_auto_number,
           max(${sql.id(AUTO_NUMBER_COLUMN)}) AS max_auto_number
    FROM ${sql.table(tableName)}
  `.execute(conn);
  const minAutoNumber = bounds.rows[0]?.min_auto_number;
  const maxAutoNumber = bounds.rows[0]?.max_auto_number;
  if (minAutoNumber != null && maxAutoNumber != null) {
    const min = Number(minAutoNumber);
    const max = Number(maxAutoNumber);
    for (let start = min; start <= max; start += ROW_ORDER_BACKFILL_CHUNK_SIZE) {
      const end = start + ROW_ORDER_BACKFILL_CHUNK_SIZE;
      await sql`
        UPDATE ${sql.table(tableName)}
        SET ${sql.id(columnName)} = ${sql.id(AUTO_NUMBER_COLUMN)}
        WHERE ${sql.id(AUTO_NUMBER_COLUMN)} >= ${start}
          AND ${sql.id(AUTO_NUMBER_COLUMN)} < ${end}
          AND ${sql.id(columnName)} IS NULL
      `.execute(conn);
    }
  }

  await sql`
    UPDATE ${sql.table(tableName)}
    SET ${sql.id(columnName)} = ${sql.id(AUTO_NUMBER_COLUMN)}
    WHERE ${sql.id(columnName)} IS NULL
  `.execute(conn);
};

const UNDEFINED_COLUMN_SQLSTATE = '42703';
const DUPLICATE_RELATION_SQLSTATE = '42P07';

/**
 * Another session may publish (rename) the pending column while this CIC
 * starts, and pods without the index lock may race on the same name.
 */
const createConcurrentIndexIfColumnExists = async (
  conn: Kysely<DynamicDB>,
  schema: string,
  tableName: string,
  columnName: string,
  indexName: string
): Promise<void> => {
  // IF NOT EXISTS skips an invalid leftover, so drop it inside the same lock.
  await dropIdleInvalidIndex(conn, schema, indexName);
  try {
    await sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS ${sql.id(indexName)}
      ON ${sql.table(tableName)} (${sql.id(columnName)})
    `.execute(conn);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code !== UNDEFINED_COLUMN_SQLSTATE && code !== DUPLICATE_RELATION_SQLSTATE) {
      throw error;
    }
  }
};

const ROW_ORDER_HEALTH_CACHE_LIMIT = 50_000;
const LEGACY_TOP_FILL_ATTEMPTS = 3;
// NULLs or a dropped index can reappear after a check (inserts outside a
// transaction, v1 writers, manual DDL), so a verified column is re-probed
// once this expires.
export const ROW_ORDER_HEALTH_CACHE_TTL_MS = 60_000;
const healthyRowOrderColumns = new Map<string, number>();

/** Test hook: forget columns already verified as indexed and fully backfilled. */
export const clearRowOrderColumnHealthCache = (): void => {
  healthyRowOrderColumns.clear();
};

const isRowOrderColumnKnownHealthy = (key: string): boolean => {
  const expiresAt = healthyRowOrderColumns.get(key);
  if (expiresAt === undefined) {
    return false;
  }
  if (expiresAt <= Date.now()) {
    healthyRowOrderColumns.delete(key);
    return false;
  }
  return true;
};

const markRowOrderColumnHealthy = (key: string): void => {
  if (healthyRowOrderColumns.size >= ROW_ORDER_HEALTH_CACHE_LIMIT) {
    const now = Date.now();
    for (const [cachedKey, expiresAt] of healthyRowOrderColumns) {
      if (expiresAt <= now) {
        healthyRowOrderColumns.delete(cachedKey);
      }
    }
  }
  if (healthyRowOrderColumns.size >= ROW_ORDER_HEALTH_CACHE_LIMIT) {
    healthyRowOrderColumns.clear();
  }
  healthyRowOrderColumns.set(key, Date.now() + ROW_ORDER_HEALTH_CACHE_TTL_MS);
};

/**
 * True when the caller's context already holds an open data transaction.
 * CIC waits for every older snapshot, including that one on another
 * connection, so such callers must skip it.
 */
export const hasOpenDataTransaction = (
  db: Kysely<DynamicDB>,
  context: IExecutionContext | undefined
): boolean => isOpenTransaction(resolvePostgresDbOrTx(db, context));

export type EnsureRowOrderColumnOnlineOptions = {
  /** Skip CIC when the caller already holds an open request transaction. */
  readonly skipConcurrentIndex?: boolean;
};

/**
 * Create the `__row_<viewId>` row-order column, backfill it from
 * `__auto_number`, and build its index on the non-transactional handle.
 */
export const ensureRowOrderColumnOnline = async (
  nonTxDb: Kysely<DynamicDB>,
  tableName: string,
  viewId: string,
  indexName: string,
  options?: EnsureRowOrderColumnOnlineOptions
): Promise<void> => {
  if (isOpenTransaction(nonTxDb)) {
    throw new Error(
      'ensureRowOrderColumnOnline must run on the non-transactional db handle (T7251): ' +
        'CONCURRENTLY index DDL and the chunked autocommit backfill cannot run inside a transaction'
    );
  }

  const orderColumnName = rowOrderColumnNameForView(viewId);
  const pendingColumnName = pendingRowOrderColumnNameForView(viewId);
  const { schemaName } = splitSchemaQualifiedTableName(tableName);
  const schema = schemaName ?? 'public';

  const advisoryLockKey = `${tableName}|${viewId}`;
  const alreadyPublished = await rowOrderColumnExists(nonTxDb, tableName, orderColumnName);
  if (
    alreadyPublished &&
    (options?.skipConcurrentIndex === true || isRowOrderColumnKnownHealthy(advisoryLockKey))
  ) {
    return;
  }

  const pglite = await isPgliteEngine(nonTxDb);
  const skipConcurrentIndex = options?.skipConcurrentIndex === true || pglite;

  if (alreadyPublished) {
    if (pglite) {
      return;
    }
    // A column published by a caller inside a transaction has no index yet;
    // the next caller without one builds it.
    if ((await readIndexValidity(nonTxDb, schema, indexName)) !== true) {
      await withRowOrderAdvisoryLock(
        nonTxDb,
        tableName,
        (conn) =>
          createConcurrentIndexIfColumnExists(conn, schema, tableName, orderColumnName, indexName),
        ROW_ORDER_INDEX_ADVISORY_LOCK_NAMESPACE
      );
    }
    // Columns published before their backfill finished (pre-T7570) still
    // hold NULLs that sort first and break anchors.
    if (await hasNullRowOrder(nonTxDb, tableName, orderColumnName)) {
      await withRowOrderAdvisoryLock(nonTxDb, advisoryLockKey, async (conn) => {
        // Inserts append after MAX(column). Once the highest NULL row is
        // filled, appends that read MAX afterwards land after every value
        // the chunks write; appends that read it earlier may still not.
        for (let attempt = 0; attempt < LEGACY_TOP_FILL_ATTEMPTS; attempt += 1) {
          const filled = await sql`
            UPDATE ${sql.table(tableName)}
            SET ${sql.id(orderColumnName)} = ${sql.id(AUTO_NUMBER_COLUMN)}
            WHERE ${sql.id(AUTO_NUMBER_COLUMN)} = (
              SELECT max(${sql.id(AUTO_NUMBER_COLUMN)})
              FROM ${sql.table(tableName)}
              WHERE ${sql.id(orderColumnName)} IS NULL
            )
              AND ${sql.id(orderColumnName)} IS NULL
          `.execute(conn);
          // 0 rows: that row was deleted or written concurrently; retry.
          if (filled.numAffectedRows !== BigInt(0)) {
            break;
          }
        }
        await backfillFromAutoNumber(conn, tableName, orderColumnName);
      });
    }
    if ((await readIndexValidity(nonTxDb, schema, indexName)) === true) {
      markRowOrderColumnHealthy(advisoryLockKey);
    }
    return;
  }

  const published = await withRowOrderAdvisoryLock(nonTxDb, advisoryLockKey, async (conn) => {
    if (await rowOrderColumnExists(conn, tableName, orderColumnName)) {
      return true;
    }

    // IF NOT EXISTS still takes AccessExclusive; a resumed run must not queue
    // it behind another session's CIC on the pending column.
    if (!(await rowOrderColumnExists(conn, tableName, pendingColumnName))) {
      await withTableDdlLock(conn, tableName, () =>
        conn.transaction().execute(async (trx) => {
          await sql`SET LOCAL lock_timeout = ${sql.lit(ROW_ORDER_COLUMN_LOCK_TIMEOUT)}`.execute(
            trx
          );
          await sql`
            ALTER TABLE ${sql.table(tableName)}
            ADD COLUMN IF NOT EXISTS ${sql.id(pendingColumnName)} double precision
          `.execute(trx);
        })
      );
    }

    await backfillFromAutoNumber(conn, tableName, pendingColumnName);
    return false;
  });

  if (!skipConcurrentIndex) {
    // The index follows the column through the rename, so building it on the
    // pending column keeps the publish sweep and the first reads indexed.
    // Concurrent CICs on one table can deadlock, so builds take their own
    // lock; losers wait for the winner and then no-op on IF NOT EXISTS.
    await withRowOrderAdvisoryLock(
      nonTxDb,
      tableName,
      (conn) =>
        createConcurrentIndexIfColumnExists(
          conn,
          schema,
          tableName,
          published ? orderColumnName : pendingColumnName,
          indexName
        ),
      ROW_ORDER_INDEX_ADVISORY_LOCK_NAMESPACE
    );
  }

  if (!published) {
    await withRowOrderAdvisoryLock(nonTxDb, advisoryLockKey, async (conn) => {
      if (await rowOrderColumnExists(conn, tableName, orderColumnName)) {
        return;
      }
      // Rows inserted during the CIC are filled here so the sweep under
      // ACCESS EXCLUSIVE only catches the last few.
      await sql`
        UPDATE ${sql.table(tableName)}
        SET ${sql.id(pendingColumnName)} = ${sql.id(AUTO_NUMBER_COLUMN)}
        WHERE ${sql.id(pendingColumnName)} IS NULL
      `.execute(conn);
      await withTableDdlLock(conn, tableName, () =>
        conn.transaction().execute(async (trx) => {
          await sql`SET LOCAL lock_timeout = ${sql.lit(ROW_ORDER_COLUMN_LOCK_TIMEOUT)}`.execute(
            trx
          );
          await sql`LOCK TABLE ${sql.table(tableName)} IN ACCESS EXCLUSIVE MODE`.execute(trx);
          await sql`
            UPDATE ${sql.table(tableName)}
            SET ${sql.id(pendingColumnName)} = ${sql.id(AUTO_NUMBER_COLUMN)}
            WHERE ${sql.id(pendingColumnName)} IS NULL
          `.execute(trx);
          await sql`
            ALTER TABLE ${sql.table(tableName)}
            RENAME COLUMN ${sql.id(pendingColumnName)} TO ${sql.id(orderColumnName)}
          `.execute(trx);
        })
      );
    });
  }

  if (pglite) {
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.id(indexName)}
      ON ${sql.table(tableName)} (${sql.id(orderColumnName)})
    `.execute(nonTxDb);
  }
};

/**
 * Transaction-aware dispatch used on the record write path (T7251).
 *
 * Online creation never falls back into the caller's transaction on a
 * committed table: 55P03/40P01 fail the request instead of re-arming
 * AccessExclusive. Callers that need the column must invoke this before
 * the request transaction takes locks on the physical table (or before
 * `withTransaction` when CIC must run).
 */
export const ensureRowOrderColumns = async (
  txDb: Kysely<DynamicDB>,
  nonTxDb: Kysely<DynamicDB>,
  tableName: string,
  viewIds: ReadonlyArray<string>
): Promise<void> => {
  const seen = new Set<string>();
  let pglite: boolean | undefined;
  for (const viewId of viewIds) {
    if (!viewId || seen.has(viewId)) {
      continue;
    }
    seen.add(viewId);

    const orderColumnName = rowOrderColumnNameForView(viewId);
    const indexName = rowOrderIndexName(tableName, viewId);
    if (await rowOrderColumnExists(txDb, tableName, orderColumnName)) {
      if (!isOpenTransaction(txDb)) {
        await ensureRowOrderColumnOnline(nonTxDb, tableName, viewId, indexName);
      }
      continue;
    }

    pglite ??= await isPgliteEngine(txDb);
    if (pglite || (await tableCreatedInCurrentTransaction(txDb, tableName))) {
      await createRowOrderColumnInTransaction(txDb, tableName, viewId, indexName);
      continue;
    }

    await ensureRowOrderColumnOnline(nonTxDb, tableName, viewId, indexName, {
      skipConcurrentIndex: isOpenTransaction(txDb),
    });
  }
};
