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
 * Creation runs on the non-transactional handle:
 *  1. information_schema fast path when the column already exists.
 *  2. `pg_try_advisory_lock(hashtext(ns), hashtext(key))` on a pinned
 *     connection. Losers poll try-lock (no blocking lock waiter — CIC in
 *     the holder deadlocks with those, prisma-engines#5755 /
 *     community/scripts/postgres-migrate-lock.mjs).
 *  3. `ADD COLUMN IF NOT EXISTS` in a short transaction with 3s
 *     `lock_timeout`. Failure is raised to the caller — never folded back
 *     into the request transaction (that re-arms AccessExclusive).
 *  4. Chunked autocommit backfill (`IS NULL` resume) + straggler sweep.
 *  5. Unlock, then `CREATE INDEX CONCURRENTLY IF NOT EXISTS`. Invalid
 *     leftovers are dropped only when `pg_stat_progress_create_index`
 *     shows no live build. CIC never runs while the advisory lock is held,
 *     and is skipped when the caller already has an open transaction
 *     (CIC waits for that snapshot → self-deadlock).
 */

export const ROW_ORDER_BACKFILL_CHUNK_SIZE = 5000;
export const ROW_ORDER_ADVISORY_LOCK_NAMESPACE = 'teable.row_order_column';
export const ROW_ORDER_ADVISORY_LOCK_WAIT_MS = 120_000;
export const ROW_ORDER_ADVISORY_LOCK_POLL_MS = 50;

const AUTO_NUMBER_COLUMN = '__auto_number';
const ROW_ORDER_COLUMN_LOCK_TIMEOUT = '3s';

export const rowOrderColumnNameForView = (viewId: string): string => `__row_${viewId}`;

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
  const qualifiedName = schemaName ? `${schemaName}.${plainTableName}` : plainTableName;
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
  advisoryLockKey: string
): Promise<void> => {
  const deadline = Date.now() + ROW_ORDER_ADVISORY_LOCK_WAIT_MS;
  for (;;) {
    const lockResult = await sql<{ locked: boolean | string }>`
      SELECT pg_try_advisory_lock(
        hashtext(${ROW_ORDER_ADVISORY_LOCK_NAMESPACE}),
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
  const { schemaName } = splitSchemaQualifiedTableName(tableName);
  const schema = schemaName ?? 'public';

  if (await rowOrderColumnExists(nonTxDb, tableName, orderColumnName)) {
    return;
  }

  const pglite = await isPgliteEngine(nonTxDb);
  const concurrentlyKeyword = pglite ? sql`` : sql`CONCURRENTLY`;
  const advisoryLockKey = `${tableName}|${viewId}`;
  const skipConcurrentIndex = options?.skipConcurrentIndex === true || pglite;

  await nonTxDb.connection().execute(async (conn) => {
    await acquireRowOrderAdvisoryLock(conn, advisoryLockKey);
    try {
      if (!(await rowOrderColumnExists(conn, tableName, orderColumnName))) {
        await conn.transaction().execute(async (trx) => {
          await sql`SET LOCAL lock_timeout = ${sql.lit(ROW_ORDER_COLUMN_LOCK_TIMEOUT)}`.execute(
            trx
          );
          await sql`
            ALTER TABLE ${sql.table(tableName)}
            ADD COLUMN IF NOT EXISTS ${sql.id(orderColumnName)} double precision
          `.execute(trx);
        });
      }

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
            SET ${sql.id(orderColumnName)} = ${sql.id(AUTO_NUMBER_COLUMN)}
            WHERE ${sql.id(AUTO_NUMBER_COLUMN)} >= ${start}
              AND ${sql.id(AUTO_NUMBER_COLUMN)} < ${end}
              AND ${sql.id(orderColumnName)} IS NULL
          `.execute(conn);
        }
      }

      await sql`
        UPDATE ${sql.table(tableName)}
        SET ${sql.id(orderColumnName)} = ${sql.id(AUTO_NUMBER_COLUMN)}
        WHERE ${sql.id(orderColumnName)} IS NULL
      `.execute(conn);

      if (!skipConcurrentIndex && !(await indexBuildInProgress(conn, schema, indexName))) {
        const indexState = await sql<{ indisvalid: boolean }>`
          SELECT i.indisvalid
          FROM pg_class c
          JOIN pg_index i ON i.indexrelid = c.oid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = ${indexName}
            AND n.nspname = ${schema}
        `.execute(conn);
        const indexRow = indexState.rows[0];
        if (indexRow && !indexRow.indisvalid) {
          await sql`DROP INDEX ${concurrentlyKeyword} IF EXISTS ${sql.id(schema, indexName)}`.execute(
            conn
          );
        }
      }
    } finally {
      await sql`
        SELECT pg_advisory_unlock(
          hashtext(${ROW_ORDER_ADVISORY_LOCK_NAMESPACE}),
          hashtext(${advisoryLockKey})
        )
      `.execute(conn);
    }
  });

  if (skipConcurrentIndex) {
    if (pglite) {
      await sql`
        CREATE INDEX IF NOT EXISTS ${sql.id(indexName)}
        ON ${sql.table(tableName)} (${sql.id(orderColumnName)})
      `.execute(nonTxDb);
    }
    return;
  }

  await sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ${sql.id(indexName)}
    ON ${sql.table(tableName)} (${sql.id(orderColumnName)})
  `.execute(nonTxDb);
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
    if (await rowOrderColumnExists(txDb, tableName, orderColumnName)) {
      continue;
    }

    const indexName = rowOrderIndexName(tableName, viewId);
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
