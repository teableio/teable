import { sql, Transaction } from 'kysely';
import type { Kysely } from 'kysely';

import { splitSchemaQualifiedTableName, type QualifiedIdentifierLiteral } from './sqlIdentifiers';

type DbOrTx<DB> = Kysely<DB> | Transaction<DB>;

export type UndoLogRow = {
  id: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  table_name: string;
  record_id: string;
  old_row: unknown;
  new_row: unknown;
};

export type UndoCaptureInfrastructureStatus =
  | 'ready'
  | 'missing_globals'
  | 'trigger_install_failed';

type UndoCaptureCache = {
  globalReady: boolean;
  tableTriggers: Set<string>;
};

const undoCaptureCaches = new WeakMap<object, UndoCaptureCache>();

const getUndoCaptureCache = (rootDb: object): UndoCaptureCache => {
  const cached = undoCaptureCaches.get(rootDb);
  if (cached) {
    return cached;
  }

  const next: UndoCaptureCache = {
    globalReady: false,
    tableTriggers: new Set<string>(),
  };
  undoCaptureCaches.set(rootDb, next);
  return next;
};

export const invalidateUndoCaptureTableCache = (
  tableKey: string | ReadonlyArray<string>,
  rootDb: object
): void => {
  const cached = undoCaptureCaches.get(rootDb);
  if (!cached) {
    return;
  }
  const tableKeys = normalizeUndoCaptureTableKeys(
    typeof tableKey === 'string' ? [tableKey] : [...tableKey]
  );

  for (const entry of tableKeys) {
    cached.tableTriggers.delete(entry);
  }
};

const nextSavepointName = () =>
  `teable_undo_capture_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

const toQuotedSavepointIdentifier = (savepointName: string) =>
  `"${savepointName.replaceAll('"', '""')}"`;

const normalizeUndoCaptureTableKeys = (tableKeys: ReadonlyArray<string>): ReadonlyArray<string> => {
  const normalized = new Set<string>();

  for (const tableKey of tableKeys) {
    if (!tableKey) {
      continue;
    }
    normalized.add(tableKey);

    const { schemaName, plainTableName } = splitSchemaQualifiedTableName(tableKey);
    if (!schemaName) {
      normalized.add(`public.${plainTableName}`);
      continue;
    }

    if (schemaName === 'public') {
      normalized.add(plainTableName);
    }
  }

  return [...normalized];
};

const isTransactionDb = <DB>(db: DbOrTx<DB>): db is Transaction<DB> =>
  db instanceof Transaction || (db as { isTransaction?: boolean }).isTransaction === true;

const runWithSavepoint = async <DB>(
  db: DbOrTx<DB>,
  work: () => Promise<void>
): Promise<boolean> => {
  const savepointName = nextSavepointName();
  const savepointIdentifier = toQuotedSavepointIdentifier(savepointName);
  try {
    await sql.raw(`SAVEPOINT ${savepointIdentifier}`).execute(db);
    await work();
    await sql.raw(`RELEASE SAVEPOINT ${savepointIdentifier}`).execute(db);
    return true;
  } catch {
    try {
      await sql.raw(`ROLLBACK TO SAVEPOINT ${savepointIdentifier}`).execute(db);
      await sql.raw(`RELEASE SAVEPOINT ${savepointIdentifier}`).execute(db);
    } catch {
      // Ignore cleanup failures to keep the caller's transaction alive when possible.
    }
    return false;
  }
};

const hasUndoLogTable = async <DB>(db: DbOrTx<DB>): Promise<boolean> => {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = '__undo_log'
    ) AS "exists"
  `.execute(db);

  return Boolean(result.rows[0]?.exists);
};

const hasUndoLogNewRowColumn = async <DB>(db: DbOrTx<DB>): Promise<boolean> => {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = '__undo_log'
      AND column_name = 'new_row'
    ) AS "exists"
  `.execute(db);

  return Boolean(result.rows[0]?.exists);
};

const hasUndoLogFunction = async <DB>(db: DbOrTx<DB>): Promise<boolean> => {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc
      WHERE proname = '__teable_capture_undo_row'
      AND pronamespace = 'public'::regnamespace
    ) AS "exists"
  `.execute(db);

  return Boolean(result.rows[0]?.exists);
};

const hasUndoCaptureTrigger = async <DB>(db: Kysely<DB>, tableKey: string): Promise<boolean> => {
  const { schemaName, plainTableName } = splitSchemaQualifiedTableName(tableKey);
  const schema = schemaName ?? 'public';
  const table = plainTableName;
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_trigger AS t
      JOIN pg_class AS c ON c.oid = t.tgrelid
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal
      AND t.tgname = '__teable_undo_capture'
      AND n.nspname = ${schema}
      AND c.relname = ${table}
    ) AS "exists"
  `.execute(db);

  return Boolean(result.rows[0]?.exists);
};

const ensureUndoCaptureGlobals = async <DB>(
  cache: UndoCaptureCache,
  db: DbOrTx<DB>
): Promise<boolean> => {
  if (cache.globalReady) {
    return true;
  }

  try {
    const hasTable = await hasUndoLogTable(db);
    const hasNewRowColumn = await hasUndoLogNewRowColumn(db);
    const hasFunction = await hasUndoLogFunction(db);

    if (hasTable && hasNewRowColumn && hasFunction) {
      cache.globalReady = true;
      return true;
    }
  } catch {
    return false;
  }

  return false;
};

/**
 * tableRef must already be quoted/escaped as a schema-qualified identifier literal.
 */
const createTableTrigger = async <DB>(db: DbOrTx<DB>, tableRef: QualifiedIdentifierLiteral) => {
  await sql
    .raw(
      `
    CREATE OR REPLACE TRIGGER "__teable_undo_capture"
    AFTER INSERT OR UPDATE OR DELETE ON ${tableRef}
    FOR EACH ROW
    EXECUTE FUNCTION "public"."__teable_capture_undo_row"()
  `
    )
    .execute(db);
};

export const ensureUndoCaptureInfrastructure = async <DB>(
  rootDb: object,
  db: DbOrTx<DB>,
  tableRef: QualifiedIdentifierLiteral,
  tableKey: string
): Promise<UndoCaptureInfrastructureStatus> => {
  const cache = getUndoCaptureCache(rootDb);
  if (cache.tableTriggers.has(tableKey) && cache.globalReady) {
    return 'ready';
  }

  const globalsEnsured = await ensureUndoCaptureGlobals(cache, db);
  if (!globalsEnsured) {
    return 'missing_globals';
  }

  if (cache.tableTriggers.has(tableKey)) {
    return 'ready';
  }

  try {
    const hasDurableTrigger = await hasUndoCaptureTrigger(rootDb as Kysely<unknown>, tableKey);
    if (hasDurableTrigger) {
      cache.tableTriggers.add(tableKey);
      return 'ready';
    }
  } catch {
    // Fall through to best-effort trigger installation in the current session.
  }

  const triggerEnsured = isTransactionDb(db)
    ? await runWithSavepoint(db, async () => {
        await createTableTrigger(db, tableRef);
      })
    : await (async () => {
        try {
          await createTableTrigger(db, tableRef);
          return true;
        } catch {
          return false;
        }
      })();

  if (triggerEnsured) {
    if (!isTransactionDb(db)) {
      cache.tableTriggers.add(tableKey);
    }
    return 'ready';
  }

  return 'trigger_install_failed';
};

export const setUndoCaptureBatchId = async <DB>(
  db: DbOrTx<DB>,
  batchId: string,
  options?: { local?: boolean }
): Promise<boolean> => {
  try {
    await sql`SELECT set_config('teable.undo_batch_id', ${batchId}, ${
      options?.local ?? isTransactionDb(db)
    })`.execute(db);
    return true;
  } catch {
    return false;
  }
};

export const getUndoCaptureBatchId = async <DB>(db: DbOrTx<DB>): Promise<string | undefined> => {
  const result = await sql<{ batch_id: string | null }>`
    SELECT NULLIF(current_setting('teable.undo_batch_id', true), '') AS "batch_id"
  `.execute(db);

  return result.rows[0]?.batch_id ?? undefined;
};

export const restoreUndoCaptureBatchId = async <DB>(
  db: DbOrTx<DB>,
  batchId?: string,
  options?: { local?: boolean }
): Promise<void> => {
  await sql`
    SELECT set_config('teable.undo_batch_id', ${batchId ?? ''}, ${
      options?.local ?? isTransactionDb(db)
    })
  `.execute(db);
};

export const clearUndoCaptureBatchId = async <DB>(
  db: DbOrTx<DB>,
  options?: { local?: boolean }
): Promise<void> => {
  await restoreUndoCaptureBatchId(db, undefined, options);
};

export const loadAndClearUndoLogRows = async <DB>(
  db: DbOrTx<DB>,
  batchId: string
): Promise<UndoLogRow[]> => {
  const rowsResult = await sql<UndoLogRow>`
    WITH deleted AS (
      DELETE FROM "public"."__undo_log"
      WHERE "batch_id" = ${batchId}
      RETURNING "id", "operation", "table_name", "record_id", "old_row", "new_row"
    )
    SELECT "id"::text AS "id", "operation", "table_name", "record_id", "old_row", "new_row"
    FROM deleted
    ORDER BY deleted."id" ASC
  `.execute(db);

  return rowsResult.rows;
};
