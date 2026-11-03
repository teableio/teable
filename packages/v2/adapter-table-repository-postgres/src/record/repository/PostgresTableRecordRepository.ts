import { sdkErrorI18nKeys } from '@teable/i18n-keys';
import * as core from '@teable/v2-core';
import {
  domainError,
  type ILogger,
  v2CoreTokens,
  type DomainError,
  type IHasher,
  type DeleteManyResult,
  generatePrefixedId,
  generateUuid,
  type RecordMutationResult,
  type BatchRecordMutationResult,
  type InsertOptions,
  type ArchiveTrashRowInput,
  type DeletedTrashMarkerInput,
  RECORD_REMOVAL_REASON,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, Transaction, type Expression, type Kysely, type SqlBool } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { resolvePostgresDbOrTx } from '../../shared/db';
import { ensureRowOrderColumns } from '../../shared/ensureRowOrderColumnOnline';
import {
  describeError,
  extractForeignKeyFieldId,
  isForeignKeyViolation,
  wrapDatabaseError,
} from '../../shared/errors';
import {
  splitSchemaQualifiedTableName,
  toQualifiedIdentifierLiteral,
} from '../../shared/sqlIdentifiers';
import {
  getUndoCaptureOldTuple,
  matchesUndoCaptureTableName,
  type UndoCaptureTupleIdentity,
  type UndoLogRow,
} from '../../shared/undoCapture';
import { isUserCellField, normalizeStoredUserAvatarUrls } from '../../shared/userAvatarUrl';
import { buildAttachmentTableBatchReplaceQueries } from '../attachments/attachmentTableMutations';
import type {
  ComputedBeforeImageRecord,
  ComputedFieldUpdater,
  ComputedUpdatePlanner,
  ComputedUpdateResult,
  IComputedUpdateOutbox,
  IComputedUpdatePauseRegistry,
  IUpdateStrategy,
  UpdateImpactHint,
} from '../computed';
import {
  buildSeedTaskInput,
  collapseRecordChangesByRecordId,
  noopComputedUpdatePauseRegistry,
} from '../computed';
import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import { normalizeStoredLinkItems } from '../normalizeLinkItems';
import type { DynamicDB } from '../query-builder';
import {
  RecordInsertBuilder,
  type CompiledSqlStatement,
  type LinkedRecordLockInfo,
  type InsertExclusivityConstraint,
} from '../query-builder/insert/RecordInsertBuilder';
import { BatchRecordUpdateBuilder } from '../query-builder/update/BatchRecordUpdateBuilder';
import {
  buildBatchUpdateSql,
  collectBatchUpdateReturnedOldFields,
  type BatchUpdateNoopReleaseSpec,
} from '../query-builder/update/BatchUpdateSqlBuilder';
import {
  collectLinkUpdateSourceRecordIds,
  RecordUpdateBuilder,
} from '../query-builder/update/RecordUpdateBuilder';
import {
  TableRecordConditionWhereVisitor,
  FieldDeleteValueVisitor,
  type OutgoingLinkDeleteOp,
} from '../visitors';
import { CellValueMutateVisitor } from '../visitors/CellValueMutateVisitor';
import type { LinkExclusivityConstraint } from '../visitors/LinkExclusivityConstraintCollector';
import { buildRecordWhereClause } from './buildRecordWhereClause';
import type {
  IPostgresRecordMutationSnapshotCaptureService,
  IPostgresRecordMutationSnapshotCaptureSession,
  RecordMutationSnapshotTraceContext,
} from './PostgresRecordMutationSnapshotCaptureService';
import {
  createDeferredInsertSeedSpool,
  type IDeferredInsertSeedSpool,
} from './PostgresTableRecordRepository.seed-spool';

// System columns (kept for update operations)
const RECORD_ID_COLUMN = '__id';
const VERSION_COLUMN = '__version';
const SYSTEM_UPDATE_COLUMNS = new Set([
  RECORD_ID_COLUMN,
  VERSION_COLUMN,
  '__last_modified_time',
  '__last_modified_by',
]);

type BulkUpdateTrackedField = {
  fieldId: core.FieldId;
  dbFieldName: string;
  oldValueAlias: string;
};

type ChangedFieldColumn = {
  fieldId: core.FieldId;
  dbFieldName: string;
  alias: string;
  isUserValue: boolean;
};

type BeforeImageCapturePlan = {
  needsBeforeImage: boolean;
  trackedFields: ReadonlyArray<BulkUpdateTrackedField>;
};

type BeforeImageTrackedRow = Record<string, unknown> & {
  record_id?: string;
};

type ExtraSeedRecordGroup = {
  tableId: core.TableId;
  recordIds: core.RecordId[];
};

type ActorIdentity = {
  actorName?: string;
  actorEmail?: string;
};

const isTrackedLastModifiedField = (field: core.Field): boolean => {
  const type = field.type();
  return (
    type.equals(core.FieldType.lastModifiedTime()) || type.equals(core.FieldType.lastModifiedBy())
  );
};

const hasLastModifiedByField = (table: core.Table): boolean =>
  table.getFields().some((field) => field.type().equals(core.FieldType.lastModifiedBy()));

const buildDistinctUserFieldWhere = (
  table: core.Table,
  setClauses: Record<string, unknown>
): Result<Expression<SqlBool> | undefined, DomainError> =>
  safeTry<Expression<SqlBool> | undefined, DomainError>(function* () {
    const conditions: Array<Expression<SqlBool>> = [];

    for (const field of table.getFields()) {
      if (isTrackedLastModifiedField(field)) {
        continue;
      }

      const dbFieldName = yield* field.dbFieldName();
      const dbFieldNameValue = yield* dbFieldName.value();
      if (
        SYSTEM_UPDATE_COLUMNS.has(dbFieldNameValue) ||
        !Object.hasOwn(setClauses, dbFieldNameValue)
      ) {
        continue;
      }

      conditions.push(
        sql<SqlBool>`${sql.ref(dbFieldNameValue)} IS DISTINCT FROM ${setClauses[dbFieldNameValue]}`
      );
    }

    if (conditions.length === 0) {
      return ok(undefined);
    }

    return ok(sql<SqlBool>`(${sql.join(conditions, sql` OR `)})`);
  });

/**
 * Convert a TableRecord's fields to a Map<string, unknown> for use with RecordInsertBuilder.
 */
function recordFieldsToMap(table: core.Table, record: core.TableRecord): Map<string, unknown> {
  const fieldValues = new Map<string, unknown>();
  const recordFields = record.fields();

  for (const field of table.getFields()) {
    const cellValue = recordFields.get(field.id());
    const rawValue = cellValue?.toValue() ?? null;
    fieldValues.set(field.id().toString(), rawValue);
  }

  return fieldValues;
}

/**
 * View order information for a table.
 * Maps view row order column names to their current max order values.
 */
type ViewOrderInfo = Map<string, number>;

const RECORD_TRASH_RESOURCE_TYPE = 'record';

const toRecordMutationSnapshotTraceContext = (
  context: core.IExecutionContext
): RecordMutationSnapshotTraceContext => ({
  tracer: context.tracer,
});

const withRepositoryTraceSpan = async <T>(
  context: core.IExecutionContext,
  operation: string,
  extraAttributes: Record<string, string | number | boolean>,
  work: () => Promise<T>
): Promise<T> => {
  const tracer = context.tracer;
  const span = tracer?.startSpan(
    `teable.PostgresTableRecordRepository.${operation}`,
    core.createTeableSpanAttributes('repository', `PostgresTableRecordRepository.${operation}`, {
      [core.TeableSpanAttributes.HANDLER]: 'PostgresTableRecordRepository',
      ...extraAttributes,
    })
  );

  if (!span || !tracer) {
    return work();
  }

  return tracer.withSpan(span, async () => {
    try {
      return await work();
    } catch (error) {
      span.recordError(describeError(error));
      throw error;
    } finally {
      span.end();
    }
  });
};

const parseTrashedRecordIds = (snapshot: unknown): string[] => {
  const parsed =
    typeof snapshot === 'string'
      ? (() => {
          try {
            return JSON.parse(snapshot) as unknown;
          } catch {
            return undefined;
          }
        })()
      : snapshot;
  return Array.isArray(parsed)
    ? parsed.filter((recordId): recordId is string => typeof recordId === 'string')
    : [];
};

const asString = (value: unknown): string | undefined => {
  return typeof value === 'string' ? value : undefined;
};

const cleanupRestoredRecordTrash = async (
  db: Kysely<DynamicDB> | Transaction<DynamicDB>,
  tableId: string,
  recordIds: ReadonlyArray<string>
): Promise<void> => {
  if (recordIds.length === 0) {
    return;
  }

  const restoredRecordIds = Array.from(new Set(recordIds));
  await db
    .deleteFrom('record_trash')
    .where('table_id', '=', tableId)
    .where('record_id', 'in', restoredRecordIds)
    .execute();

  const tableTrashItems = await db
    .selectFrom('table_trash')
    .select(['id', 'snapshot'])
    .where('table_id', '=', tableId)
    .where('resource_type', '=', RECORD_TRASH_RESOURCE_TYPE)
    .execute();

  const restoredRecordIdSet = new Set(restoredRecordIds);
  const candidateTrashItems = tableTrashItems.flatMap((item) => {
    const id = asString(item.id);
    if (!id) {
      return [];
    }

    const recordIds = parseTrashedRecordIds(item.snapshot);
    if (
      recordIds.length === 0 ||
      !recordIds.some((recordId) => restoredRecordIdSet.has(recordId))
    ) {
      return [];
    }

    return [{ id, recordIds }];
  });

  if (candidateTrashItems.length === 0) {
    return;
  }

  const candidateRecordIds = Array.from(
    new Set(candidateTrashItems.flatMap((item) => item.recordIds))
  );
  const remainingRecordTrashEntries = await db
    .selectFrom('record_trash')
    .select('record_id')
    .where('table_id', '=', tableId)
    .where('record_id', 'in', candidateRecordIds)
    .execute();
  const remainingRecordIdSet = new Set(
    remainingRecordTrashEntries
      .map((entry) => asString(entry.record_id))
      .filter((recordId): recordId is string => recordId != null)
  );
  const staleTrashIds = candidateTrashItems
    .filter((item) => item.recordIds.every((recordId) => !remainingRecordIdSet.has(recordId)))
    .map((item) => item.id);

  if (staleTrashIds.length === 0) {
    return;
  }

  await db.deleteFrom('table_trash').where('id', 'in', staleTrashIds).execute();
};

// Mirrors @teable/core generateRecordTrashId ('rtr' + 16 random chars).
const RECORD_TRASH_ID_PREFIX = 'rtr';
const RECORD_TRASH_ID_LENGTH = 16;

/**
 * Internal insert options that extend core InsertOptions with PostgreSQL-specific flags.
 */
interface InternalInsertManyOptions extends core.InsertOptions {
  /**
   * When true, computed field updates are skipped entirely.
   * insertManyStream persists deferred seeds separately from the current batch write.
   */
  skipComputedUpdates?: boolean;
  /**
   * When true, insert snapshot capture is skipped.
   * Restore/import flows do not need undo snapshots and may run before capture
   * infrastructure is installed in ephemeral databases.
   */
  skipSnapshotCapture?: boolean;

  /**
   * When true, do not return changed field payloads for inserted rows. Bulk
   * restore/duplicate flows only need the row count and can avoid pulling large
   * JSON/text values back from Postgres.
   */
  skipChangedFields?: boolean;
}

/**
 * Get view order information for all views in a table.
 * Queries the max row order value for each view's order column.
 * Only includes columns that actually exist in the table schema.
 */
async function getViewOrderInfo(
  db: Kysely<DynamicDB>,
  tableName: string,
  views: ReadonlyArray<core.View>
): Promise<ViewOrderInfo> {
  const viewOrderInfo: ViewOrderInfo = new Map();

  if (views.length === 0) {
    return viewOrderInfo;
  }

  // Get all potential order column names
  const potentialColumns = views.map((view) => view.id().toRowOrderColumnName());

  // Split db table name (schema.table) for information_schema lookup.
  const splitIndex = tableName.indexOf('.');
  const schemaName = splitIndex === -1 ? 'public' : tableName.slice(0, splitIndex);
  const plainTableName = splitIndex === -1 ? tableName : tableName.slice(splitIndex + 1);

  // Pin the column list until commit: a row-order column published between
  // the lookup below and the INSERT would receive NULL (T7570). The publish
  // takes ACCESS EXCLUSIVE, so it either sweeps this row or precedes it.
  if (isKyselyTransaction(db)) {
    try {
      await sql`LOCK TABLE ${sql.table(tableName)} IN ROW EXCLUSIVE MODE`.execute(db);
    } catch (error) {
      // A reused transaction handle can outlive its transaction block. The probe and
      // insert still work on the connection; only the column-pinning lock is unavailable.
      if (
        !(error instanceof Error) ||
        !error.message.includes('LOCK TABLE can only be used in transaction blocks')
      ) {
        throw error;
      }
    }
  }

  // First, check which columns actually exist in the table.
  try {
    const existingColumnsResult = await sql<{ column_name: string }>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${schemaName}
      AND table_name = ${plainTableName}
    `.execute(db);

    const existingColumns = new Set(existingColumnsResult.rows.map((row) => row.column_name));

    // Filter to only columns that exist
    const columnNames = potentialColumns.filter((col) => existingColumns.has(col));

    if (columnNames.length === 0) {
      return viewOrderInfo;
    }

    // Query max values for existing order columns
    const selectParts = columnNames.map((col) =>
      sql<number>`COALESCE(MAX(${sql.ref(col)}), 0)`.as(col)
    );

    const result = await db.selectFrom(tableName).select(selectParts).executeTakeFirst();

    if (result) {
      for (const col of columnNames) {
        const maxValue = (result as Record<string, unknown>)[col];
        viewOrderInfo.set(col, typeof maxValue === 'number' ? maxValue : 0);
      }
    }
  } catch {
    // If query fails, return empty map
  }

  return viewOrderInfo;
}

/**
 * Build view order values for a record being inserted.
 * Each view gets order = currentMaxOrder + recordIndex + 1
 */
function buildViewOrderValues(
  viewOrderInfo: ViewOrderInfo,
  recordIndex: number
): Record<string, number> {
  const values: Record<string, number> = {};

  for (const [columnName, maxOrder] of viewOrderInfo) {
    values[columnName] = maxOrder + recordIndex + 1;
  }

  return values;
}

function buildSnapshotViewOrderValues(
  orders?: Readonly<Record<string, number>>
): Record<string, number> {
  if (!orders) {
    return {};
  }

  const values: Record<string, number> = {};
  for (const [viewId, order] of Object.entries(orders)) {
    if (typeof order !== 'number') {
      continue;
    }
    values[`__row_${viewId}`] = order;
  }

  return values;
}

/**
 * Snapshot orders win per view; views whose row-order column was created
 * after the snapshot append like a fresh insert instead of staying NULL.
 */
function buildRestoredViewOrderValues(
  viewOrderInfo: ViewOrderInfo,
  recordIndex: number,
  orders?: Readonly<Record<string, number>>
): Record<string, number> {
  return {
    ...buildViewOrderValues(viewOrderInfo, recordIndex),
    ...buildSnapshotViewOrderValues(orders),
  };
}

/**
 * Collect db field names for system audit fields that may still be physical
 * GENERATED ALWAYS columns on legacy tables (meta can drift).
 */
function collectUserAuditFieldColumnNames(table: core.Table): string[] {
  const names: string[] = [];
  for (const field of table.getFields()) {
    const type = field.type().toString();
    if (type !== 'createdBy' && type !== 'lastModifiedBy') {
      continue;
    }
    const dbFieldNameResult = field.dbFieldName().andThen((name) => name.value());
    if (dbFieldNameResult.isOk() && dbFieldNameResult.value) {
      names.push(dbFieldNameResult.value);
    }
  }
  return names;
}

/**
 * PostgreSQL rejects INSERT of non-DEFAULT values into GENERATED ALWAYS columns.
 * Strip those columns from insert value maps when the physical column is generated
 * (handles meta.persistedAsGeneratedColumn drift on legacy CreatedBy columns).
 */
async function stripPhysicallyGeneratedColumnsFromInsertValues(
  db: Kysely<DynamicDB>,
  tableName: string,
  candidateColumnNames: ReadonlyArray<string>,
  valuesList: Array<Record<string, unknown>>
): Promise<void> {
  if (!candidateColumnNames.length || !valuesList.length) {
    return;
  }

  const presentColumns = candidateColumnNames.filter((name) =>
    valuesList.some((values) => Object.hasOwn(values, name))
  );
  if (!presentColumns.length) {
    return;
  }

  const { schemaName, plainTableName } = splitSchemaQualifiedTableName(tableName);
  try {
    const result = await sql<{ column_name: string }>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${schemaName ?? 'public'}
      AND table_name = ${plainTableName}
      AND column_name IN (${sql.join(presentColumns.map((name) => sql`${name}`))})
      AND is_generated IS DISTINCT FROM 'NEVER'
    `.execute(db);

    if (!result.rows.length) {
      return;
    }

    for (const row of result.rows) {
      for (const values of valuesList) {
        delete values[row.column_name];
      }
    }
  } catch {
    // Best-effort safety net; insert will surface the original error if this fails.
  }
}

async function listPhysicalColumnNames(
  db: Kysely<DynamicDB>,
  tableName: string
): Promise<string[]> {
  const { schemaName, plainTableName } = splitSchemaQualifiedTableName(tableName);
  const schema = schemaName ?? 'public';
  const result = await sql<{ column_name: string }>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = ${schema}
      AND table_name = ${plainTableName}
  `.execute(db);
  return result.rows.map((row) => row.column_name);
}

/**
 * T7251: lazily create missing `__row_<viewId>` columns. Existence check
 * runs on `db`; creation is online on `nonTxDb` for committed tables, or
 * in-transaction only when the table was created by the current transaction.
 * Never falls back to in-transaction DDL on a table other sessions can see.
 */
async function ensureViewOrderColumnsExist(
  db: Kysely<DynamicDB>,
  nonTxDb: Kysely<DynamicDB>,
  tableName: string,
  viewIds: ReadonlyArray<string>
): Promise<void> {
  await ensureRowOrderColumns(db, nonTxDb, tableName, viewIds);
}
const toSqlTableRef = (tableName: string) => {
  const { schemaName, plainTableName } = splitSchemaQualifiedTableName(tableName);
  return schemaName ? sql.id(schemaName, plainTableName) : sql.id(plainTableName);
};

const toOptionalIsoString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return undefined;
};

const buildStoredRecordSnapshotFromRow = (
  table: core.Table,
  row: Record<string, unknown>
): Result<core.RecordStoredSnapshot, DomainError> =>
  safeTry(function* () {
    const recordId = row[RECORD_ID_COLUMN];
    if (typeof recordId !== 'string' || recordId.length === 0) {
      return err(
        domainError.infrastructure({
          code: 'record.snapshot.invalid_record_id',
          message: 'Stored record snapshot is missing __id',
        })
      );
    }

    const fields: Record<string, unknown> = {};
    for (const field of table.getFields()) {
      const dbFieldNameResult = field.dbFieldName();
      if (dbFieldNameResult.isErr()) {
        continue;
      }
      const dbFieldName = yield* dbFieldNameResult;
      const dbFieldNameText = yield* dbFieldName.value();
      if (!Object.hasOwn(row, dbFieldNameText)) {
        continue;
      }
      fields[field.id().toString()] = row[dbFieldNameText];
    }

    const orders: Record<string, number> = {};
    for (const view of table.views()) {
      const orderValue = row[view.id().toRowOrderColumnName()];
      if (typeof orderValue === 'number' && Number.isFinite(orderValue)) {
        orders[view.id().toString()] = orderValue;
      }
    }

    const autoNumber = row.__auto_number;
    const rawVersion = row[VERSION_COLUMN];
    const createdTime = row.__created_time;
    const createdBy = row.__created_by;
    const lastModifiedTime = row.__last_modified_time;
    const lastModifiedBy = row.__last_modified_by;

    return ok({
      recordId,
      fields,
      ...(typeof rawVersion === 'number' ? { version: rawVersion } : {}),
      ...(Object.keys(orders).length > 0 ? { orders } : {}),
      ...(typeof autoNumber === 'number' ? { autoNumber } : {}),
      ...(toOptionalIsoString(createdTime)
        ? { createdTime: toOptionalIsoString(createdTime) }
        : {}),
      ...(typeof createdBy === 'string' ? { createdBy } : {}),
      ...(toOptionalIsoString(lastModifiedTime)
        ? { lastModifiedTime: toOptionalIsoString(lastModifiedTime) }
        : {}),
      ...(typeof lastModifiedBy === 'string' ? { lastModifiedBy } : {}),
    });
  });

const buildStoredRecordSnapshotsByRows = (
  table: core.Table,
  rows: ReadonlyArray<Record<string, unknown>>
): Result<ReadonlyArray<core.RecordStoredSnapshot>, DomainError> =>
  safeTry(function* () {
    const snapshots: core.RecordStoredSnapshot[] = [];
    for (const row of rows) {
      const snapshot = yield* buildStoredRecordSnapshotFromRow(table, row);
      snapshots.push(snapshot);
    }
    return ok(snapshots);
  });

const toStoredRowObject = (value: unknown): Record<string, unknown> | undefined => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
};

const groupUndoLogRowsByRecordId = (
  rows: ReadonlyArray<UndoLogRow>,
  recordIds?: ReadonlyArray<string>
): Map<string, ReadonlyArray<UndoLogRow>> => {
  const targetRecordIds = recordIds ? new Set(recordIds) : undefined;
  const grouped = new Map<string, UndoLogRow[]>();
  for (const row of rows) {
    if (!row.record_id) {
      continue;
    }
    if (targetRecordIds && !targetRecordIds.has(row.record_id)) {
      continue;
    }
    const recordRows = grouped.get(row.record_id);
    if (recordRows) {
      recordRows.push(row);
    } else {
      grouped.set(row.record_id, [row]);
    }
  }
  return grouped;
};

const buildStoredRecordSnapshotsFromCurrentUndoRows = (
  table: core.Table,
  rows: ReadonlyArray<UndoLogRow>,
  recordIds: ReadonlyArray<string>
): Result<ReadonlyArray<core.RecordStoredSnapshot>, DomainError> => {
  if (recordIds.length === 0) {
    return ok([]);
  }

  return safeTry(function* () {
    const groupedRows = groupUndoLogRowsByRecordId(rows, recordIds);
    const currentRows: Record<string, unknown>[] = [];
    for (const recordId of recordIds) {
      const recordRows = groupedRows.get(recordId) ?? [];
      for (let index = recordRows.length - 1; index >= 0; index -= 1) {
        const currentRow = toStoredRowObject(recordRows[index]?.new_row);
        if (currentRow) {
          currentRows.push(currentRow);
          break;
        }
      }
    }
    const snapshots = yield* buildStoredRecordSnapshotsByRows(table, currentRows);
    return ok(snapshots);
  });
};

const buildStoredRecordSnapshotsFromDeletedUndoRows = (
  table: core.Table,
  rows: ReadonlyArray<UndoLogRow>,
  recordIds: ReadonlyArray<string>
): Result<ReadonlyArray<core.RecordStoredSnapshot>, DomainError> => {
  if (recordIds.length === 0) {
    return ok([]);
  }

  return safeTry(function* () {
    const groupedRows = groupUndoLogRowsByRecordId(rows, recordIds);
    const deletedRows: Record<string, unknown>[] = [];
    for (const recordId of recordIds) {
      const recordRows = groupedRows.get(recordId) ?? [];
      for (let index = recordRows.length - 1; index >= 0; index -= 1) {
        const recordRow = recordRows[index];
        if (
          recordRow?.operation !== 'DELETE' &&
          !(recordRow?.old_row != null && recordRow?.new_row == null)
        ) {
          continue;
        }
        const deletedRow = toStoredRowObject(recordRow.old_row);
        if (deletedRow) {
          deletedRows.push(deletedRow);
          break;
        }
      }
    }
    const snapshots = yield* buildStoredRecordSnapshotsByRows(table, deletedRows);
    return ok(snapshots);
  });
};

const buildRecordUpdateSnapshotFromUndoRows = (
  table: core.Table,
  rows: ReadonlyArray<UndoLogRow>,
  recordId: string
): Result<core.RecordUpdateSnapshot | undefined, DomainError> =>
  safeTry(function* () {
    const groupedRows = groupUndoLogRowsByRecordId(rows, [recordId]);
    const recordRows = groupedRows.get(recordId) ?? [];
    const updateRows = recordRows.filter(
      (row) => row.operation === 'UPDATE' || (row.old_row != null && row.new_row != null)
    );
    if (updateRows.length === 0) {
      return ok(undefined);
    }

    const previousRow = toStoredRowObject(updateRows[0]?.old_row);
    let currentRow: Record<string, unknown> | undefined;
    for (let index = updateRows.length - 1; index >= 0; index -= 1) {
      currentRow = toStoredRowObject(updateRows[index]?.new_row);
      if (currentRow) {
        break;
      }
    }

    if (!previousRow || !currentRow) {
      return ok(undefined);
    }

    const previousSnapshot = yield* buildStoredRecordSnapshotFromRow(table, previousRow);
    const currentSnapshot = yield* buildStoredRecordSnapshotFromRow(table, currentRow);
    const oldVersion =
      typeof previousRow[VERSION_COLUMN] === 'number'
        ? Number(previousRow[VERSION_COLUMN])
        : undefined;
    const newVersion =
      typeof currentRow[VERSION_COLUMN] === 'number'
        ? Number(currentRow[VERSION_COLUMN])
        : undefined;

    if (oldVersion == null || newVersion == null) {
      return err(
        domainError.infrastructure({
          code: 'record.snapshot.update_version_missing',
          message: `Stored update snapshot is missing __version for "${table.id().toString()}" / "${recordId}".`,
        })
      );
    }

    return ok({
      previous: previousSnapshot,
      current: currentSnapshot,
      oldVersion,
      newVersion,
    });
  });

const buildMissingSnapshotError = (
  operation: 'insert' | 'update' | 'delete',
  tableId: string,
  expectedCount: number,
  actualCount: number
): DomainError =>
  domainError.infrastructure({
    code: `record.snapshot.${operation}_capture_incomplete`,
    message: `Failed to capture complete ${operation} snapshots for "${tableId}". Expected ${expectedCount}, got ${actualCount}.`,
  });

async function syncAutoNumberSequence(db: Kysely<DynamicDB>, tableName: string): Promise<void> {
  const qualifiedTableName = toQualifiedIdentifierLiteral(tableName);
  const sequenceResult = await sql<{ seq_name: string | null }>`
    SELECT pg_get_serial_sequence(${qualifiedTableName}, '__auto_number') AS seq_name
  `.execute(db);

  const sequenceName = sequenceResult.rows[0]?.seq_name;
  if (!sequenceName) {
    return;
  }

  const tableRef = toSqlTableRef(tableName);
  await sql`
    SELECT setval(
      ${sequenceName},
      GREATEST(COALESCE((SELECT MAX(__auto_number) FROM ${tableRef}), 0), 1),
      true
    )
  `.execute(db);
}

async function tableHasExistingRows(db: Kysely<DynamicDB>, tableName: string): Promise<boolean> {
  const tableRef = toSqlTableRef(tableName);
  const result = await sql<{ has_rows: boolean }>`
    SELECT EXISTS (SELECT 1 FROM ${tableRef} LIMIT 1) AS has_rows
  `.execute(db);
  return Boolean(result.rows[0]?.has_rows);
}

async function analyzeSeededTable(
  db: Kysely<DynamicDB>,
  tableName: string,
  tableWasEmpty: boolean
): Promise<void> {
  if (!tableWasEmpty) {
    return;
  }

  const tableRef = toSqlTableRef(tableName);
  await sql`ANALYZE ${tableRef}`.execute(db);
}

const toBulkUpdateTrackedFields = (
  table: core.Table,
  changedFieldIds: ReadonlyArray<core.FieldId>
): Result<ReadonlyArray<BulkUpdateTrackedField>, DomainError> =>
  safeTry(function* () {
    const trackedFields: BulkUpdateTrackedField[] = [];
    for (const fieldId of changedFieldIds) {
      const field = yield* table.getField((candidate) => candidate.id().equals(fieldId));
      const dbFieldName = yield* field.dbFieldName();
      trackedFields.push({
        fieldId,
        dbFieldName: yield* dbFieldName.value(),
        oldValueAlias: `old_${fieldId.toString()}`,
      });
    }
    return ok(trackedFields);
  });

const toChangedFieldColumns = (
  table: core.Table,
  changedFieldIds: ReadonlyArray<core.FieldId>
): Result<ReadonlyArray<ChangedFieldColumn>, DomainError> =>
  safeTry(function* () {
    const changedColumns: ChangedFieldColumn[] = [];
    for (const [index, fieldId] of changedFieldIds.entries()) {
      const field = yield* table.getField((candidate) => candidate.id().equals(fieldId));
      const dbFieldName = yield* field.dbFieldName();
      changedColumns.push({
        fieldId,
        dbFieldName: yield* dbFieldName.value(),
        alias: `changed_${index}`,
        isUserValue: isUserCellField(field),
      });
    }
    return ok(changedColumns);
  });

const buildChangedFieldReturningSelects = (columns: ReadonlyArray<ChangedFieldColumn>) =>
  columns.map(({ dbFieldName, alias }) => sql.ref(dbFieldName).as(alias));

const toChangedFieldsMap = (
  row: Record<string, unknown> | undefined,
  columns: ReadonlyArray<ChangedFieldColumn>,
  allowedFieldIds?: ReadonlySet<string>
): ReadonlyMap<string, unknown> | undefined => {
  if (!row || columns.length === 0) {
    return undefined;
  }

  const changedFields = new Map<string, unknown>();
  for (const { fieldId, alias, isUserValue } of columns) {
    const fieldIdStr = fieldId.toString();
    if (allowedFieldIds && !allowedFieldIds.has(fieldIdStr)) {
      continue;
    }
    const value = row[alias];
    changedFields.set(fieldIdStr, isUserValue ? normalizeStoredUserAvatarUrls(value) : value);
  }
  return changedFields.size > 0 ? changedFields : undefined;
};

const presentUpdatedUserValues = (
  table: core.Table,
  records: core.UpdateManyResult['updatedRecords']
): void => {
  const userFieldIds = table
    .getFields()
    .filter(isUserCellField)
    .map((field) => field.id().toString());
  for (const record of records) {
    let oldValues: Record<string, unknown> | undefined;
    let changedFields: Map<string, unknown> | undefined;
    for (const fieldId of userFieldIds) {
      if (Object.hasOwn(record.oldFieldValues, fieldId)) {
        const value = record.oldFieldValues[fieldId];
        const displayed = normalizeStoredUserAvatarUrls(value);
        if (displayed !== value) {
          oldValues ??= { ...record.oldFieldValues };
          oldValues[fieldId] = displayed;
        }
      }
      if (record.changedFields?.has(fieldId)) {
        const value = record.changedFields.get(fieldId);
        const displayed = normalizeStoredUserAvatarUrls(value);
        if (displayed !== value) {
          changedFields ??= new Map(record.changedFields);
          changedFields.set(fieldId, displayed);
        }
      }
    }
    if (oldValues) record.oldFieldValues = oldValues;
    if (changedFields) record.changedFields = changedFields;
  }
};

const buildBeforeImageFromTrackedValues = (
  recordId: core.RecordId,
  trackedFields: ReadonlyArray<BulkUpdateTrackedField>,
  oldFieldValues: Readonly<Record<string, unknown>>
): ComputedBeforeImageRecord => ({
  recordId,
  fieldValuesByDbName: Object.fromEntries(
    trackedFields.map(({ fieldId, dbFieldName }) => [
      dbFieldName,
      oldFieldValues[fieldId.toString()],
    ])
  ),
});

const buildEmptyBeforeImageRecord = (recordId: core.RecordId): ComputedBeforeImageRecord => ({
  recordId,
  fieldValuesByDbName: {},
});

const buildLinkExtraSeedRecords = (
  table: core.Table,
  linkFieldIds: ReadonlyArray<core.FieldId>,
  updatedRecords: ReadonlyArray<{ oldFieldValues: Readonly<Record<string, unknown>> }>,
  physicalLinkOwners: ReadonlyMap<string, ReadonlySet<string>>
): Result<ExtraSeedRecordGroup[], DomainError> =>
  safeTry(function* () {
    const extraSeedMap = new Map<
      string,
      { tableId: core.TableId; recordIds: Map<string, core.RecordId> }
    >();

    for (const fieldId of linkFieldIds) {
      const field = yield* table.getField((candidate) => candidate.id().equals(fieldId));
      if (!field.type().equals(core.FieldType.link())) continue;

      const linkField = field as core.LinkField;
      if (linkField.isOneWay()) continue;

      const foreignRecordIds = new Set(physicalLinkOwners.get(fieldId.toString()));
      for (const record of updatedRecords) {
        for (const item of normalizeStoredLinkItems(record.oldFieldValues[fieldId.toString()])) {
          foreignRecordIds.add(item.id);
        }
      }

      yield* mergeExtraSeedRecords(extraSeedMap, linkField.foreignTableId(), [...foreignRecordIds]);
    }

    return ok(finalizeExtraSeedRecords(extraSeedMap));
  });

const mergeTrackedFields = (
  ...groups: ReadonlyArray<ReadonlyArray<BulkUpdateTrackedField>>
): ReadonlyArray<BulkUpdateTrackedField> => {
  const trackedFields = new Map<string, BulkUpdateTrackedField>();
  for (const group of groups) {
    for (const field of group) {
      trackedFields.set(field.fieldId.toString(), field);
    }
  }
  return [...trackedFields.values()];
};

/**
 * PostgreSQL implementation of TableRecordRepository.
 *
 * Handles insert, update, and delete operations for table records.
 */
@injectable()
export class PostgresTableRecordRepository implements core.ITableRecordRepository {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(v2CoreTokens.recordOrderCalculator)
    private readonly recordOrderCalculator: core.IRecordOrderCalculator,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdatePlanner)
    private readonly computedUpdatePlanner: ComputedUpdatePlanner,
    @inject(v2RecordRepositoryPostgresTokens.computedFieldUpdater)
    private readonly computedFieldUpdater: ComputedFieldUpdater,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateStrategy)
    private readonly computedUpdateStrategy: IUpdateStrategy,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateOutbox)
    private readonly computedUpdateOutbox: IComputedUpdateOutbox,
    @inject(v2RecordRepositoryPostgresTokens.recordMutationSnapshotCaptureService)
    private readonly recordMutationSnapshotCapture: IPostgresRecordMutationSnapshotCaptureService,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: core.IEventBus,
    @inject(v2CoreTokens.hasher)
    private readonly hasher: IHasher,
    @inject(v2RecordRepositoryPostgresTokens.metaDb)
    private readonly metaDb: Kysely<V1TeableDatabase> = db,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdatePauseRegistry)
    private readonly pauseRegistry: IComputedUpdatePauseRegistry = noopComputedUpdatePauseRegistry
  ) {}

  private async enqueueAdmittedSeedTask(
    context: core.IExecutionContext,
    table: core.Table,
    seedTask: Parameters<IComputedUpdateOutbox['enqueueSeedTask']>[0]
  ) {
    const admitted = await this.pauseRegistry.admitComputedWrite(
      {
        tableId: table.id().toString(),
        baseId: table.baseId().toString(),
      },
      context
    );
    if (admitted.isErr()) return admitted;
    return this.computedUpdateOutbox.enqueueSeedTask(seedTask, context);
  }

  private async resolveBeforeImageCapturePlan(
    context: core.IExecutionContext,
    table: core.Table,
    changedFieldIds: ReadonlyArray<core.FieldId>,
    changeType: 'update' | 'delete',
    impact?: UpdateImpactHint
  ): Promise<Result<BeforeImageCapturePlan, DomainError>> {
    if (changedFieldIds.length === 0) {
      return ok({
        needsBeforeImage: false,
        trackedFields: [],
      });
    }

    const requirementResult = await this.computedUpdatePlanner.resolveBeforeImageRequirements(
      {
        baseId: table.baseId(),
        seedTableId: table.id(),
        changedFieldIds,
        changeType,
        impact,
      },
      context
    );
    if (requirementResult.isErr()) {
      return err(requirementResult.error);
    }

    const trackedFieldsResult = toBulkUpdateTrackedFields(
      table,
      requirementResult.value.requiredFieldIds
    );
    if (trackedFieldsResult.isErr()) {
      return err(trackedFieldsResult.error);
    }

    return ok({
      needsBeforeImage: requirementResult.value.needsBeforeImage,
      trackedFields: trackedFieldsResult.value,
    });
  }

  private async resolveRestoreActorIdentity(
    db: Kysely<DynamicDB>,
    userId: string | null | undefined,
    fallback: ActorIdentity
  ): Promise<ActorIdentity> {
    if (!userId) {
      return fallback;
    }

    return this.resolveActorIdentity(db, userId, fallback);
  }

  private async resolveUpdateActorIdentity(
    context: core.IExecutionContext,
    table: core.Table,
    actorId: string,
    actorContext: ActorIdentity
  ): Promise<ActorIdentity> {
    if (!hasLastModifiedByField(table) || actorContext.actorName != null) {
      return actorContext;
    }

    return this.resolveActorIdentity(this.resolveMetaDb(context), actorId, actorContext);
  }

  async insert(
    context: core.IExecutionContext,
    table: core.Table,
    record: core.TableRecord,
    options?: InsertOptions
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return safeTry<RecordMutationResult, DomainError>(
      async function* (this: PostgresTableRecordRepository) {
        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();

        const now = new Date().toISOString();
        const actorId = context.actorId.toString();
        const actorContext = context as core.IExecutionContext & {
          actorName?: string;
          actorEmail?: string;
        };
        const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
        // Resolve actor identity outside transaction-scoped connection to avoid
        // marking the current transaction as aborted when optional lookup fails.
        const actorLookupDb = this.metaDb as unknown as Kysely<DynamicDB>;
        const actorIdentity = await this.resolveActorIdentity(actorLookupDb, actorId, actorContext);
        const restoreValues = options?.restoreRecordsById?.get(record.id().toString());
        // T7251: lazily create missing view row-order columns BEFORE this
        // transaction touches the physical table (getViewOrderInfo / the
        // insert below take locks held until commit). Missing-column creation
        // runs online on the non-transactional handle inside
        // ensureViewOrderColumnsExist — never in this transaction.
        const ensureOrderViewIds = [
          ...Object.keys(restoreValues?.orders ?? {}),
          ...(options?.order ? [options.order.viewId.toString()] : []),
        ];
        if (ensureOrderViewIds.length > 0) {
          await ensureViewOrderColumnsExist(
            db,
            this.db as unknown as Kysely<DynamicDB>,
            tableName,
            ensureOrderViewIds
          );
        }
        const createdByIdentity = await this.resolveRestoreActorIdentity(
          actorLookupDb,
          restoreValues?.createdBy,
          restoreValues?.createdBy === actorId ? actorIdentity : {}
        );
        const lastModifiedByIdentity = await this.resolveRestoreActorIdentity(
          actorLookupDb,
          restoreValues?.lastModifiedBy ?? undefined,
          restoreValues?.lastModifiedBy === restoreValues?.createdBy
            ? createdByIdentity
            : restoreValues?.lastModifiedBy === actorId
              ? actorIdentity
              : {}
        );

        // Get view order info for all views in the table.
        // Must run on the transaction-scoped connection: the probe reads the
        // physical table, which the current transaction may have just created
        // or altered. A transaction-external connection would wait on this
        // transaction's own locks while this transaction awaits the probe —
        // a connection-level self-deadlock (T6657).
        const views = table.views();
        const viewOrderInfo = await getViewOrderInfo(db, tableName, views);

        // Use RecordInsertBuilder to build insert data
        const insertBuilder = new RecordInsertBuilder(db);
        const fieldValues = recordFieldsToMap(table, record);
        const {
          values,
          additionalStatements,
          linkedRecordLocks,
          exclusivityConstraints,
          extraSeedRecords,
        } = yield* insertBuilder.buildInsertData({
          table,
          fieldValues,
          context: {
            recordId: record.id().toString(),
            actorId: context.actorId.toString(),
            now,
            ...(restoreValues?.version !== undefined ? { version: restoreValues.version } : {}),
            actorName: actorIdentity.actorName,
            actorEmail: actorIdentity.actorEmail,
            ...(restoreValues?.createdTime ? { createdTime: restoreValues.createdTime } : {}),
            ...(restoreValues?.createdBy ? { createdBy: restoreValues.createdBy } : {}),
            ...(createdByIdentity.actorName ? { createdByName: createdByIdentity.actorName } : {}),
            ...(createdByIdentity.actorEmail
              ? { createdByEmail: createdByIdentity.actorEmail }
              : {}),
            ...(restoreValues?.lastModifiedTime !== undefined
              ? { lastModifiedTime: restoreValues.lastModifiedTime }
              : {}),
            ...(restoreValues?.lastModifiedBy !== undefined
              ? { lastModifiedBy: restoreValues.lastModifiedBy }
              : {}),
            ...(lastModifiedByIdentity.actorName
              ? { lastModifiedByName: lastModifiedByIdentity.actorName }
              : {}),
            ...(lastModifiedByIdentity.actorEmail
              ? { lastModifiedByEmail: lastModifiedByIdentity.actorEmail }
              : {}),
            ...(restoreValues?.autoNumber !== undefined
              ? { autoNumber: restoreValues.autoNumber }
              : {}),
            ...(options?.fillLinkTitles ? { fillLinkTitles: true } : {}),
            ...(options?.fillLinkTitleForeignTables
              ? { fillLinkTitleForeignTables: options.fillLinkTitleForeignTables }
              : {}),
          },
        });

        // Add view order columns (default: append to end).
        // (Missing row-order columns were ensured up front — see T7251.)
        let viewOrderValues = buildRestoredViewOrderValues(viewOrderInfo, 0, restoreValues?.orders);

        // If ordering is specified, calculate order value for the target view
        if (options?.order) {
          const orderColumnName = options.order.viewId.toRowOrderColumnName();
          const orderValuesResult = await this.recordOrderCalculator.calculateOrders(
            context,
            table,
            options.order.viewId,
            options.order.anchorId,
            options.order.position,
            1
          );
          if (orderValuesResult.isErr()) {
            return err(orderValuesResult.error);
          }

          // Override the target view's order value
          viewOrderValues = {
            ...viewOrderValues,
            [orderColumnName]: orderValuesResult.value[0],
          };
        }

        const valuesWithViewOrder = {
          ...values,
          ...viewOrderValues,
        };
        const requestedChangedFieldIds = record
          .fields()
          .entries()
          .map((entry) => entry.fieldId);
        const changedFieldColumns = yield* toChangedFieldColumns(table, requestedChangedFieldIds);

        // Convert InsertExtraSeedGroup to ExtraSeedRecordGroup
        const extraSeedRecordGroups: ExtraSeedRecordGroup[] = extraSeedRecords.map((group) => ({
          tableId: group.tableId,
          recordIds: group.recordIds,
        }));

        if (exclusivityConstraints.length > 0 || linkedRecordLocks.length > 0) {
          yield* requireLinkWriteTransaction(db);
        }

        this.logger.debug(`insert:table=${tableName}`, { values: valuesWithViewOrder });

        // Legacy CreatedBy/LastModifiedBy columns may still be GENERATED ALWAYS even when
        // field meta says otherwise — strip them so PostgreSQL accepts the INSERT (T6146).
        await stripPhysicallyGeneratedColumnsFromInsertValues(
          db,
          tableName,
          collectUserAuditFieldColumnNames(table),
          [valuesWithViewOrder]
        );

        let snapshotCaptureSession: IPostgresRecordMutationSnapshotCaptureSession | undefined;
        try {
          snapshotCaptureSession = yield* await this.recordMutationSnapshotCapture.begin(
            toRecordMutationSnapshotTraceContext(context),
            db,
            tableName
          );

          const insertedRow =
            changedFieldColumns.length > 0
              ? ((await db
                  .insertInto(tableName)
                  .values(valuesWithViewOrder)
                  .returning(buildChangedFieldReturningSelects(changedFieldColumns))
                  .executeTakeFirst()) as Record<string, unknown> | undefined)
              : (await db.insertInto(tableName).values(valuesWithViewOrder).execute(), undefined);
          if (restoreValues?.autoNumber !== undefined) {
            await syncAutoNumberSequence(db, tableName);
          }

          yield* await acquireLinkedRecordLocks(db, table.baseId().toString(), linkedRecordLocks);
          yield* await acquireInsertExclusiveTargetLocks(db, exclusivityConstraints);
          yield* await validateInsertExclusivityConstraints(context, db, exclusivityConstraints);

          // Execute additional statements (junction inserts, FK updates, user field updates, etc.)
          await RecordInsertBuilder.executeStatements(db, additionalStatements);

          const computedResult = yield* await this.runComputedUpdate(
            context,
            table,
            record,
            'insert',
            undefined,
            extraSeedRecordGroups
          );
          // Extract computed changes for this specific record
          const mutationRows = yield* await snapshotCaptureSession.finish();
          const computedChanges = extractChangesForRecord(computedResult, record.id().toString());
          const capturedSnapshots = yield* buildStoredRecordSnapshotsFromCurrentUndoRows(
            table,
            mutationRows,
            [record.id().toString()]
          );
          const snapshot = capturedSnapshots[0];
          if (capturedSnapshots.length !== 1 || !snapshot) {
            this.logger.warn('record:snapshot:missing', {
              operation: 'insert',
              tableId: table.id().toString(),
              recordIds: [record.id().toString()],
              expectedCount: 1,
              actualCount: capturedSnapshots.length,
            });
            return err(
              buildMissingSnapshotError(
                'insert',
                table.id().toString(),
                1,
                capturedSnapshots.length
              )
            );
          }
          await this.touchTableMeta(context, table.id().toString(), actorId);
          const changedFields = toChangedFieldsMap(insertedRow, changedFieldColumns);
          return ok({
            changedFields,
            computedChanges,
            recordSnapshot: snapshot,
          });
        } catch (error) {
          await snapshotCaptureSession?.abort();
          return err(wrapDatabaseError(error, 'insert', { tableName, fields: table.getFields() }));
        }
      }.bind(this)
    );
  }

  /**
   * Default row cap for insertMany. Wide tables can use many bind parameters per
   * row, so the effective batch size is reduced dynamically before execution.
   */
  private static readonly INSERT_BATCH_SIZE = 500;
  // Keep well below PostgreSQL's 65,535 bind-parameter ceiling to avoid
  // protocol overflow and leave room for driver/dialect quirks on wide tables.
  private static readonly POSTGRES_BIND_PARAMETER_SAFE_LIMIT = 30_000;

  private static resolveInsertBatchSize(values: ReadonlyArray<Record<string, unknown>>): number {
    const columnNames = new Set<string>();
    for (const value of values) {
      for (const columnName of Object.keys(value)) {
        columnNames.add(columnName);
      }
    }

    if (columnNames.size === 0) {
      return PostgresTableRecordRepository.INSERT_BATCH_SIZE;
    }

    const bindLimitedBatchSize = Math.floor(
      PostgresTableRecordRepository.POSTGRES_BIND_PARAMETER_SAFE_LIMIT / columnNames.size
    );
    return Math.max(
      1,
      Math.min(PostgresTableRecordRepository.INSERT_BATCH_SIZE, bindLimitedBatchSize)
    );
  }

  async insertMany(
    context: core.IExecutionContext,
    table: core.Table,
    records: ReadonlyArray<core.TableRecord>,
    options?: InternalInsertManyOptions
  ): Promise<Result<BatchRecordMutationResult, DomainError>> {
    return safeTry<BatchRecordMutationResult, DomainError>(
      async function* (this: PostgresTableRecordRepository) {
        if (records.length === 0) {
          return ok({});
        }

        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();

        const now = new Date().toISOString();
        const actorId = context.actorId.toString();
        const actorContext = context as core.IExecutionContext & {
          actorName?: string;
          actorEmail?: string;
        };
        const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
        // T7251: lazily create missing view row-order columns BEFORE this
        // transaction touches the physical table (tableHasExistingRows /
        // getViewOrderInfo / the inserts below take locks held until commit).
        // Missing-column creation runs online on the non-transactional handle
        // inside ensureViewOrderColumnsExist — never in this transaction.
        const restoreViewIds = options?.restoreRecordsById
          ? [...options.restoreRecordsById.values()].flatMap((value) =>
              Object.keys(value.orders ?? {})
            )
          : [];
        const ensureOrderViewIds = options?.order
          ? [...restoreViewIds, options.order.viewId.toString()]
          : restoreViewIds;
        if (ensureOrderViewIds.length > 0) {
          await ensureViewOrderColumnsExist(
            db,
            this.db as unknown as Kysely<DynamicDB>,
            tableName,
            ensureOrderViewIds
          );
        }
        const shouldCaptureSnapshot = !options?.skipSnapshotCapture && !options?.restoreRecordsById;
        const tableWasEmpty = !(await tableHasExistingRows(db, tableName));
        // Resolve actor identity outside transaction-scoped connection to avoid
        // marking the current transaction as aborted when optional lookup fails.
        const actorLookupDb = this.metaDb as unknown as Kysely<DynamicDB>;
        const actorIdentity = await this.resolveActorIdentity(actorLookupDb, actorId, actorContext);
        const restoreIdentityCache = new Map<string, ActorIdentity>();
        const resolveRestoreIdentity = async (
          userId: string | null | undefined,
          fallback: ActorIdentity
        ) => {
          if (!userId) {
            return fallback;
          }
          const cached = restoreIdentityCache.get(userId);
          if (cached) {
            return cached;
          }
          const identity = await this.resolveRestoreActorIdentity(actorLookupDb, userId, fallback);
          restoreIdentityCache.set(userId, identity);
          return identity;
        };

        // Get view order info for all views in the table.
        // Must run on the transaction-scoped connection: the probe reads the
        // physical table, which the current transaction may have just created
        // or altered. A transaction-external connection would wait on this
        // transaction's own locks while this transaction awaits the probe —
        // a connection-level self-deadlock (T6657).
        const views = table.views();
        const viewOrderInfo = await getViewOrderInfo(db, tableName, views);

        // Pre-calculate order values if ordering is specified
        let calculatedOrderValues: number[] | undefined;
        let orderColumnName: string | undefined;

        if (options?.order) {
          orderColumnName = options.order.viewId.toRowOrderColumnName();
          const orderValuesResult = await this.recordOrderCalculator.calculateOrders(
            context,
            table,
            options.order.viewId,
            options.order.anchorId,
            options.order.position,
            records.length
          );
          if (orderValuesResult.isErr()) {
            return err(orderValuesResult.error);
          }
          calculatedOrderValues = [...orderValuesResult.value];
        }

        // Use RecordInsertBuilder to build insert data for all records
        const insertBuilder = new RecordInsertBuilder(db);
        const allValues: Record<string, unknown>[] = [];
        const allAdditionalStatements: CompiledSqlStatement[] = [];
        const allLinkedRecordLocks: LinkedRecordLockInfo[] = [];
        const allExclusivityConstraints: InsertExclusivityConstraint[] = [];
        const allExtraSeedRecordsMap = new Map<
          string,
          { tableId: core.TableId; recordIds: Map<string, core.RecordId> }
        >();
        // Collect order values per record for undo/redo support
        const recordOrdersMap = new Map<string, Record<string, number>>();
        let hasExplicitAutoNumberRestore = false;
        const requestedChangedFieldIdsByRecord = new Map<string, ReadonlySet<string>>();

        let recordIndex = 0;
        for (const record of records) {
          const restoreValues = options?.restoreRecordsById?.get(record.id().toString());
          const createdByIdentity = await resolveRestoreIdentity(
            restoreValues?.createdBy,
            restoreValues?.createdBy === actorId ? actorIdentity : {}
          );
          const lastModifiedByIdentity = await resolveRestoreIdentity(
            restoreValues?.lastModifiedBy ?? undefined,
            restoreValues?.lastModifiedBy === restoreValues?.createdBy
              ? createdByIdentity
              : restoreValues?.lastModifiedBy === actorId
                ? actorIdentity
                : {}
          );
          const fieldValues = recordFieldsToMap(table, record);
          const insertDataResult = insertBuilder.buildInsertData({
            table,
            fieldValues,
            context: {
              recordId: record.id().toString(),
              actorId: context.actorId.toString(),
              now,
              ...(restoreValues?.version !== undefined ? { version: restoreValues.version } : {}),
              actorName: actorIdentity.actorName,
              actorEmail: actorIdentity.actorEmail,
              ...(restoreValues?.createdTime ? { createdTime: restoreValues.createdTime } : {}),
              ...(restoreValues?.createdBy ? { createdBy: restoreValues.createdBy } : {}),
              ...(createdByIdentity.actorName
                ? { createdByName: createdByIdentity.actorName }
                : {}),
              ...(createdByIdentity.actorEmail
                ? { createdByEmail: createdByIdentity.actorEmail }
                : {}),
              ...(restoreValues?.lastModifiedTime !== undefined
                ? { lastModifiedTime: restoreValues.lastModifiedTime }
                : {}),
              ...(restoreValues?.lastModifiedBy !== undefined
                ? { lastModifiedBy: restoreValues.lastModifiedBy }
                : {}),
              ...(lastModifiedByIdentity.actorName
                ? { lastModifiedByName: lastModifiedByIdentity.actorName }
                : {}),
              ...(lastModifiedByIdentity.actorEmail
                ? { lastModifiedByEmail: lastModifiedByIdentity.actorEmail }
                : {}),
              ...(restoreValues?.autoNumber !== undefined
                ? { autoNumber: restoreValues.autoNumber }
                : {}),
              ...(options?.fillLinkTitles ? { fillLinkTitles: true } : {}),
              ...(options?.fillLinkTitleForeignTables
                ? { fillLinkTitleForeignTables: options.fillLinkTitleForeignTables }
                : {}),
            },
          });

          if (insertDataResult.isErr()) {
            return err(insertDataResult.error);
          }
          if (restoreValues?.autoNumber !== undefined) {
            hasExplicitAutoNumberRestore = true;
          }

          // Add view order columns for each view (default: append to end).
          let viewOrderValues = buildRestoredViewOrderValues(
            viewOrderInfo,
            recordIndex,
            restoreValues?.orders
          );

          // If ordering is specified, override the target view's order value
          if (calculatedOrderValues && orderColumnName) {
            viewOrderValues = {
              ...viewOrderValues,
              [orderColumnName]: calculatedOrderValues[recordIndex],
            };
          }

          const valuesWithViewOrder = {
            ...insertDataResult.value.values,
            ...restoreValues?.extraColumnValues,
            ...viewOrderValues,
          };

          // Store order values for this record (convert column names to view IDs)
          const recordId = record.id().toString();
          const ordersByViewId: Record<string, number> = {};
          for (const [columnName, orderValue] of Object.entries(viewOrderValues)) {
            // Column name format: __row_{viewId}, extract viewId
            const viewId = columnName.replace('__row_', '');
            ordersByViewId[viewId] = orderValue;
          }
          if (Object.keys(ordersByViewId).length > 0) {
            recordOrdersMap.set(recordId, ordersByViewId);
          }
          requestedChangedFieldIdsByRecord.set(
            recordId,
            new Set(
              record
                .fields()
                .entries()
                .map((entry) => entry.fieldId.toString())
            )
          );

          allValues.push(valuesWithViewOrder);
          allAdditionalStatements.push(...insertDataResult.value.additionalStatements);
          allLinkedRecordLocks.push(...insertDataResult.value.linkedRecordLocks);
          allExclusivityConstraints.push(...insertDataResult.value.exclusivityConstraints);

          // Collect extra seed records from all link fields
          for (const seedGroup of insertDataResult.value.extraSeedRecords) {
            const tableIdStr = seedGroup.tableId.toString();
            const entry = allExtraSeedRecordsMap.get(tableIdStr) ?? {
              tableId: seedGroup.tableId,
              recordIds: new Map<string, core.RecordId>(),
            };
            for (const recordId of seedGroup.recordIds) {
              entry.recordIds.set(recordId.toString(), recordId);
            }
            allExtraSeedRecordsMap.set(tableIdStr, entry);
          }

          recordIndex++;
        }

        // Convert Map to ExtraSeedRecordGroup array
        const allExtraSeedRecordGroups: ExtraSeedRecordGroup[] = [
          ...allExtraSeedRecordsMap.values(),
        ].map((entry) => ({
          tableId: entry.tableId,
          recordIds: [...entry.recordIds.values()],
        }));

        if (allExclusivityConstraints.length > 0 || allLinkedRecordLocks.length > 0) {
          yield* requireLinkWriteTransaction(db);
        }

        this.logger.debug(`insertMany:table=${tableName}`, { count: records.length });

        // Restore of archived records: drop the attachment reference rows kept at archive
        // time BEFORE the insert statements write fresh ones, or usage double-counts.
        if (options?.cleanupAttachmentRefRecordIds?.length) {
          await db
            .deleteFrom('attachments_table')
            .where('table_id', '=', table.id().toString())
            .where('record_id', 'in', [...options.cleanupAttachmentRefRecordIds])
            .execute();
        }

        // Legacy CreatedBy/LastModifiedBy columns may still be GENERATED ALWAYS even when
        // field meta says otherwise — strip them so PostgreSQL accepts the INSERT (T6146).
        await stripPhysicallyGeneratedColumnsFromInsertValues(
          db,
          tableName,
          collectUserAuditFieldColumnNames(table),
          allValues
        );

        let snapshotCaptureSession: IPostgresRecordMutationSnapshotCaptureSession | undefined;
        try {
          if (shouldCaptureSnapshot) {
            snapshotCaptureSession = yield* await this.recordMutationSnapshotCapture.begin(
              toRecordMutationSnapshotTraceContext(context),
              db,
              tableName
            );
          }

          // Execute batch inserts to stay under PG parameter limit.
          const batchSize = PostgresTableRecordRepository.resolveInsertBatchSize(allValues);
          const requestedChangedFieldIds = [...requestedChangedFieldIdsByRecord.values()].flatMap(
            (fieldIds) => [...fieldIds]
          );
          const uniqueChangedFieldIds: core.FieldId[] = [];
          const uniqueChangedFieldIdSet = new Set<string>();
          for (const fieldIdStr of requestedChangedFieldIds) {
            if (uniqueChangedFieldIdSet.has(fieldIdStr)) {
              continue;
            }
            const fieldId = yield* core.FieldId.create(fieldIdStr);
            uniqueChangedFieldIds.push(fieldId);
            uniqueChangedFieldIdSet.add(fieldIdStr);
          }
          const changedFieldColumns = options?.skipChangedFields
            ? []
            : yield* toChangedFieldColumns(table, uniqueChangedFieldIds);
          const changedFieldsByRecord = new Map<string, ReadonlyMap<string, unknown>>();
          for (let i = 0; i < allValues.length; i += batchSize) {
            const batch = allValues.slice(i, i + batchSize);
            if (changedFieldColumns.length > 0) {
              const rows = (await db
                .insertInto(tableName)
                .values(batch)
                .returning([
                  sql.ref(RECORD_ID_COLUMN).as('record_id'),
                  ...buildChangedFieldReturningSelects(changedFieldColumns),
                ])
                .execute()) as Array<Record<string, unknown>>;
              for (const row of rows) {
                const recordId = asString(row.record_id);
                if (!recordId) {
                  continue;
                }
                const allowedFieldIds = requestedChangedFieldIdsByRecord.get(recordId);
                const changedFields = toChangedFieldsMap(row, changedFieldColumns, allowedFieldIds);
                if (changedFields) {
                  changedFieldsByRecord.set(recordId, changedFields);
                }
              }
            } else {
              await db.insertInto(tableName).values(batch).execute();
            }
          }
          await analyzeSeededTable(db, tableName, tableWasEmpty);
          if (hasExplicitAutoNumberRestore) {
            await syncAutoNumberSequence(db, tableName);
          }

          yield* await acquireLinkedRecordLocks(
            db,
            table.baseId().toString(),
            allLinkedRecordLocks
          );
          yield* await acquireInsertExclusiveTargetLocks(db, allExclusivityConstraints);
          yield* await validateInsertExclusivityConstraints(context, db, allExclusivityConstraints);

          // Execute additional statements (junction inserts, FK updates, user field updates, etc.)
          await RecordInsertBuilder.executeStatements(db, allAdditionalStatements);

          if (options?.cleanupTrashRecordIds?.length) {
            await cleanupRestoredRecordTrash(
              db,
              table.id().toString(),
              options.cleanupTrashRecordIds
            );
          }

          // Run computed updates unless explicitly skipped (for deferred batch processing)
          let computedResult: ComputedUpdateResult | undefined;
          if (!options?.skipComputedUpdates) {
            computedResult = yield* await this.runComputedUpdateMany(
              context,
              table,
              records,
              'insert',
              allExtraSeedRecordGroups,
              [],
              options
            );
          }
          // Extract computed changes for all records
          const mutationRows = snapshotCaptureSession
            ? yield* await snapshotCaptureSession.finish()
            : [];
          const computedChangesByRecord = extractChangesForAllRecords(computedResult);
          const capturedSnapshots = snapshotCaptureSession
            ? yield* buildStoredRecordSnapshotsFromCurrentUndoRows(
                table,
                mutationRows,
                records.map((record) => record.id().toString())
              )
            : [];
          if (shouldCaptureSnapshot && capturedSnapshots.length !== records.length) {
            this.logger.warn('record:snapshot:missing', {
              operation: 'insert',
              tableId: table.id().toString(),
              recordIds: records.map((record) => record.id().toString()),
              expectedCount: records.length,
              actualCount: capturedSnapshots.length,
            });
            return err(
              buildMissingSnapshotError(
                'insert',
                table.id().toString(),
                records.length,
                capturedSnapshots.length
              )
            );
          }
          await this.touchTableMeta(context, table.id().toString(), actorId);
          return ok({
            changedFieldsByRecord:
              changedFieldsByRecord.size > 0 ? changedFieldsByRecord : undefined,
            computedChangesByRecord,
            recordOrders: recordOrdersMap.size > 0 ? recordOrdersMap : undefined,
            recordSnapshots: capturedSnapshots.length > 0 ? capturedSnapshots : undefined,
          });
        } catch (error) {
          await snapshotCaptureSession?.abort();
          return err(wrapDatabaseError(error, 'insert', { tableName, fields: table.getFields() }));
        }
      }.bind(this)
    );
  }

  /**
   * Server-side row clone: `INSERT INTO target (…) SELECT … FROM source RETURNING __id`,
   * then optional junction `INSERT…SELECT` for external link storage (T6153 / T6156).
   */
  async duplicatePhysicalRows(
    context: core.IExecutionContext,
    plan: core.PhysicalTableDuplicatePlan,
    targetTable: core.Table
  ): Promise<Result<core.PhysicalTableDuplicateResult, DomainError>> {
    if (plan.columns.length === 0) {
      return ok({ rowCount: 0, recordIds: [] });
    }

    const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;

    const sourceColumns = await listPhysicalColumnNames(db, plan.sourceTableName);
    const sourceColumnSet = new Set(sourceColumns);
    const { schemaName, plainTableName } = splitSchemaQualifiedTableName(plan.targetTableName);
    const generatedColumns = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = ${schemaName ?? 'public'}
        AND table_name = ${plainTableName}
        AND is_generated = 'ALWAYS'
    `.execute(db);
    const generatedColumnSet = new Set(generatedColumns.rows.map((row) => row.column_name));

    const activeColumns = plan.columns.filter((column) => {
      // Let the target compute generated values from its fresh system columns.
      if (generatedColumnSet.has(column.targetColumn)) {
        return false;
      }
      // Constants like `1` are not source column references.
      const sourceColumnMatch = column.sourceSql.match(/^"((?:[^"]|"")*)"$/);
      if (!sourceColumnMatch) {
        return true;
      }
      const sourceColumn = sourceColumnMatch[1]!.replaceAll('""', '"');
      return sourceColumnSet.has(sourceColumn);
    });

    // A target row-order column whose source column is missing would be
    // created empty and never backfilled: the lazy path skips existing
    // columns, so every row would stay NULL and anchored moves would misplace
    // records. Leave it missing so reads fall back to `__auto_number`.
    const activeTargetColumns = new Set(activeColumns.map((column) => column.targetColumn));
    const targetOrderViewIds = plan.ensureTargetOrderColumns.filter((viewId) =>
      activeTargetColumns.has(`__row_${viewId}`)
    );
    if (targetOrderViewIds.length > 0) {
      // The schema repository registered this target's OID on the same data
      // transaction, including FK DDL that rewrites the catalog tuple's xmin.
      await ensureViewOrderColumnsExist(
        db,
        this.db as unknown as Kysely<DynamicDB>,
        plan.targetTableName,
        targetOrderViewIds
      );
    }

    if (activeColumns.length === 0) {
      return ok({ rowCount: 0, recordIds: [] });
    }

    const targetCols = activeColumns
      .map((column) => toQualifiedIdentifierLiteral(column.targetColumn))
      .join(', ');
    const sourceExprs = activeColumns.map((column) => column.sourceSql).join(', ');
    const targetRef = toSqlTableRef(plan.targetTableName);
    const sourceRef = toSqlTableRef(plan.sourceTableName);

    const result = await sql<{ __id: string }>`
          INSERT INTO ${targetRef} (${sql.raw(targetCols)})
          SELECT ${sql.raw(sourceExprs)}
          FROM ${sourceRef}
          ORDER BY ${sql.id('__auto_number')}
          RETURNING ${sql.id('__id')}
        `.execute(db);

    const junctionCopies = plan.junctionCopies ?? [];
    for (const junction of junctionCopies) {
      const targetJunctionRef = toSqlTableRef(junction.targetJunctionTable);
      const sourceJunctionRef = toSqlTableRef(junction.sourceJunctionTable);
      const targetSelf = toQualifiedIdentifierLiteral(junction.targetSelfKey);
      const targetForeign = toQualifiedIdentifierLiteral(junction.targetForeignKey);
      const sourceSelf = toQualifiedIdentifierLiteral(junction.sourceSelfKey);
      const sourceForeign = toQualifiedIdentifierLiteral(junction.sourceForeignKey);

      // Prefer copying __order when both junction tables have it — link reads
      // may ignore rows with null order for multi-value relationships.
      const sourceJunctionColumns = await listPhysicalColumnNames(db, junction.sourceJunctionTable);
      const targetJunctionColumns = await listPhysicalColumnNames(db, junction.targetJunctionTable);
      const copyOrder =
        sourceJunctionColumns.includes('__order') && targetJunctionColumns.includes('__order');

      if (copyOrder) {
        await sql`
              INSERT INTO ${targetJunctionRef} (
                ${sql.raw(targetSelf)},
                ${sql.raw(targetForeign)},
                ${sql.raw(toQualifiedIdentifierLiteral('__order'))}
              )
              SELECT
                ${sql.raw(sourceSelf)},
                ${sql.raw(sourceForeign)},
                ${sql.raw(toQualifiedIdentifierLiteral('__order'))}
              FROM ${sourceJunctionRef}
            `.execute(db);
      } else {
        await sql`
              INSERT INTO ${targetJunctionRef} (${sql.raw(targetSelf)}, ${sql.raw(targetForeign)})
              SELECT ${sql.raw(sourceSelf)}, ${sql.raw(sourceForeign)}
              FROM ${sourceJunctionRef}
            `.execute(db);
      }
    }

    const recordIds = result.rows.map((row) => row.__id);
    const resetFieldIds = targetTable
      .getFields()
      .filter(
        (field) =>
          field.type().equals(core.FieldType.autoNumber()) ||
          field.type().equals(core.FieldType.createdTime()) ||
          field.type().equals(core.FieldType.lastModifiedTime()) ||
          field.type().equals(core.FieldType.lastModifiedBy())
      )
      .map((field) => field.id());
    if (recordIds.length > 0 && resetFieldIds.length > 0) {
      const seedRecordIds: core.RecordId[] = [];
      for (const id of recordIds) {
        const recordId = core.RecordId.create(id);
        if (recordId.isErr()) return err(recordId.error);
        seedRecordIds.push(recordId.value);
      }
      // These are changed system values, not edits: recompute their consumers without
      // initializing modification fields or waiting for an eventual outbox update.
      const computedPlan = await this.computedUpdatePlanner.plan(
        {
          table: targetTable,
          changedFieldIds: this.expandComputedSeedFieldIds(targetTable, resetFieldIds, {
            includeZeroReferenceFormulas: true,
          }),
          changedRecordIds: seedRecordIds,
          changeType: 'update',
          cyclePolicy: 'skip',
        },
        context,
        {
          tableProvisionStates: ['ready', 'pending'],
          scopedPendingTableIds: [targetTable.id()],
          includeComputedSeedFields: true,
        }
      );
      if (computedPlan.isErr()) return err(computedPlan.error);
      const computedResult = await this.computedFieldUpdater.execute(computedPlan.value, context);
      if (computedResult.isErr()) return err(computedResult.error);
    }
    return ok({ rowCount: recordIds.length, recordIds });
  }

  async insertManyStream(
    context: core.IExecutionContext,
    table: core.Table,
    batches:
      | Iterable<core.InsertManyStreamBatchInput>
      | AsyncIterable<core.InsertManyStreamBatchInput>,
    options?: core.InsertManyStreamOptions
  ): Promise<Result<core.InsertManyStreamResult, DomainError>> {
    let totalInserted = 0;
    let batchIndex = 0;
    const skipComputed = options?.skipComputedUpdates ?? false;
    const deferComputed = !skipComputed && (options?.deferComputedUpdates ?? false);
    const enqueueDeferredComputedUpdates =
      deferComputed && (options?.enqueueDeferredComputedUpdates ?? false);

    const seedContext = context.requestId ? context : { ...context, requestId: generateUuid() };
    const deferredTables = new Map<string, core.Table>();
    let deferredSeeds: IDeferredInsertSeedSpool | undefined;
    let deferredScheduled = false;
    let hasEnqueuedSeeds = false;

    const normalizeBatch = (
      batch: core.InsertManyStreamBatchInput
    ): {
      batchTable: core.Table;
      records: ReadonlyArray<core.TableRecord>;
      restoreRecordsById?: ReadonlyMap<string, core.RecordRestoreSystemValues>;
    } =>
      core.isInsertManyStreamBatch(batch)
        ? {
            batchTable: batch.table ?? table,
            records: batch.records,
            restoreRecordsById: batch.restoreRecordsById,
          }
        : { batchTable: table, records: batch };

    // Handle both sync and async iterables
    const processBatch = async (batch: core.InsertManyStreamBatchInput) => {
      const { batchTable, records, restoreRecordsById } = normalizeBatch(batch);
      const result = await this.insertMany(context, batchTable, records, {
        orchestration: options?.orchestration,
        skipComputedUpdates: skipComputed || deferComputed,
        skipSnapshotCapture: restoreRecordsById != null,
        skipChangedFields: options?.skipChangedFields,
        ...(restoreRecordsById ? { restoreRecordsById } : {}),
      });
      if (result.isErr()) {
        return result;
      }

      if (deferComputed && records.length > 0) {
        const { recordIds, changedFieldIds } = this.collectInsertSeeds(batchTable, records);
        if (changedFieldIds.length > 0) {
          if (enqueueDeferredComputedUpdates) {
            const enqueued = await this.enqueueDeferredInsertSeeds(
              seedContext,
              batchTable,
              recordIds,
              changedFieldIds,
              totalInserted + records.length,
              options?.orchestration
            );
            if (enqueued.isErr()) return err(enqueued.error);
            hasEnqueuedSeeds ||= enqueued.value;
          } else {
            if (!deferredSeeds) {
              deferredSeeds = await createDeferredInsertSeedSpool();
              const spool = deferredSeeds;
              core
                .getUnitOfWorkTransaction(context, 'data')
                ?.afterRollback?.(() => spool.dispose());
            }
            deferredTables.set(batchTable.id().toString(), batchTable);
            await deferredSeeds.append({
              tableId: batchTable.id().toString(),
              recordIds: recordIds.map((id) => id.toString()),
              changedFieldIds: changedFieldIds.map((id) => id.toString()),
            });
          }
        }
      }

      totalInserted += records.length;
      options?.onBatchInserted?.({
        batchIndex,
        insertedCount: records.length,
        totalInserted,
        recordOrders: result.value.recordOrders,
      });
      batchIndex++;
      return ok(undefined);
    };

    // An import source is a stream this adapter does not own. Its failure
    // (network/read cut) is reported separately from a write failure so callers
    // keep progress and retry, while DomainErrors raised by the source pass
    // through unchanged.
    let sourceFailure: { error: unknown } | undefined;
    const nextBatch = async (
      iterator:
        | AsyncIterator<core.InsertManyStreamBatchInput>
        | Iterator<core.InsertManyStreamBatchInput>
    ): Promise<IteratorResult<core.InsertManyStreamBatchInput> | undefined> => {
      try {
        return await iterator.next();
      } catch (error) {
        if (core.isDomainError(error)) throw error;
        sourceFailure = { error };
        return undefined;
      }
    };

    let iterator:
      | AsyncIterator<core.InsertManyStreamBatchInput>
      | Iterator<core.InsertManyStreamBatchInput>
      | undefined;
    let iterationCompleted = false;
    try {
      iterator =
        Symbol.asyncIterator in batches
          ? (batches as AsyncIterable<core.InsertManyStreamBatchInput>)[Symbol.asyncIterator]()
          : (batches as Iterable<core.InsertManyStreamBatchInput>)[Symbol.iterator]();
      let next = await nextBatch(iterator);
      while (next !== undefined && !next.done) {
        const result = await processBatch(next.value);
        if (result.isErr()) {
          throw result.error;
        }
        next = await nextBatch(iterator);
      }
      iterationCompleted = next !== undefined;

      if (sourceFailure) {
        return err(
          core.domainError.infrastructure({
            code: 'record.insert_many_stream.source_interrupted',
            message: `Record insert source was interrupted after ${totalInserted} row(s) in ${batchIndex} batch(es); nothing was committed, retry the whole source.`,
            details: {
              insertedRows: totalInserted,
              insertedBatches: batchIndex,
              retryable: true,
            },
            // Non-enumerable diagnostic; public message/details stay bounded.
            cause: sourceFailure.error,
          })
        );
      }

      if (hasEnqueuedSeeds) {
        const dispatchContext = core.withoutTransaction(context);
        const dispatch = () => this.computedUpdateStrategy.scheduleDispatch(dispatchContext);
        const transaction = core.getUnitOfWorkTransaction(context, 'data');
        if (transaction?.afterCommit) transaction.afterCommit(dispatch);
        else if (!transaction) dispatch();
      }

      if (deferredSeeds) {
        await deferredSeeds.seal();
        this.scheduleDeferredInsertSeeds(
          seedContext,
          deferredTables,
          deferredSeeds,
          totalInserted,
          options?.orchestration
        );
        deferredScheduled = true;
      }

      return ok({ totalInserted });
    } catch (error) {
      return err(
        core.isDomainError(error)
          ? error
          : core.domainError.unexpected({
              code: 'record.insert_many_stream.iteration_failed',
              message: `Unexpected insert stream error: ${describeError(error)}`,
            })
      );
    } finally {
      // for-await closes the source on early exit; a manual loop must do the
      // same so a partially consumed source is released. Cleanup failures are
      // swallowed so they never replace the error that ended iteration.
      if (!iterationCompleted) {
        try {
          await iterator?.return?.();
        } catch {
          // The original error (write or source) is the one callers see.
        }
      }
      if (!deferredScheduled) await deferredSeeds?.dispose();
    }
  }

  private scheduleDeferredInsertSeeds(
    context: core.IExecutionContext,
    tables: ReadonlyMap<string, core.Table>,
    spool: IDeferredInsertSeedSpool,
    recordCount: number,
    orchestration?: core.IBatchMutationOrchestration
  ): void {
    const computeContext = core.withoutTransaction(context);
    const replay = async () => {
      try {
        for await (const batch of spool.batches()) {
          const table = tables.get(batch.tableId);
          if (!table) throw new Error(`Missing deferred insert table ${batch.tableId}`);
          const recordIds = batch.recordIds.map((id) => core.RecordId.create(id)._unsafeUnwrap());
          const changedFieldIds = batch.changedFieldIds.map((id) =>
            core.FieldId.create(id)._unsafeUnwrap()
          );
          const result = await this.runComputedUpdateManySeeds(
            computeContext,
            table,
            recordIds,
            changedFieldIds,
            'insert',
            [],
            [],
            { orchestration },
            recordCount
          );
          if (result.isErr()) {
            this.logger.warn('computed:deferred:failed', {
              error: result.error.message,
              tableId: batch.tableId,
              recordCount,
            });
            return;
          }
        }
      } finally {
        await spool.dispose();
      }
    };
    const run = () => {
      void replay().catch((error) => {
        this.logger.warn('computed:deferred:failed', { error: describeError(error), recordCount });
      });
    };
    const transaction = core.getUnitOfWorkTransaction(context, 'data');
    if (transaction?.afterCommit) transaction.afterCommit(run);
    else run();
  }

  private collectInsertSeeds(
    table: core.Table,
    records: ReadonlyArray<core.TableRecord>
  ): { recordIds: core.RecordId[]; changedFieldIds: core.FieldId[] } {
    const fieldIds = new Map<string, core.FieldId>();
    const recordIds: core.RecordId[] = [];

    for (const record of records) {
      recordIds.push(record.id());
      for (const entry of record.fields().entries()) {
        fieldIds.set(entry.fieldId.toString(), entry.fieldId);
      }
    }

    for (const field of table.getFields()) {
      if (field.type().equals(core.FieldType.link())) {
        continue;
      }
      const fieldId = field.id();
      fieldIds.set(fieldId.toString(), fieldId);
    }

    return {
      recordIds,
      changedFieldIds: this.expandComputedSeedFieldIds(table, [...fieldIds.values()], {
        includeZeroReferenceFormulas: true,
      }),
    };
  }

  private async enqueueDeferredInsertSeeds(
    context: core.IExecutionContext,
    table: core.Table,
    recordIds: core.RecordId[],
    changedFieldIds: core.FieldId[],
    recordCount: number,
    orchestration?: core.IBatchMutationOrchestration
  ): Promise<Result<boolean, DomainError>> {
    if (!this.shouldEnqueuePlanFreeSeed(table, changedFieldIds, 'insert')) return ok(false);

    const seedTask = buildSeedTaskInput({
      baseId: table.baseId(),
      seedTableId: table.id(),
      seedRecordIds: recordIds,
      extraSeedRecords: [],
      beforeImageRecords: [],
      changedFieldIds,
      changeType: 'insert',
      cyclePolicy: 'skip',
      hasher: this.hasher,
      runId: context.requestId ?? generateUuid(),
      orchestration: resolveComputedRealtimeOrchestration(context, recordCount, orchestration),
    });

    const enqueueResult = await this.enqueueAdmittedSeedTask(context, table, seedTask);
    if (enqueueResult.isErr()) {
      return err(enqueueResult.error);
    }

    return ok(true);
  }

  async updateOne(
    context: core.IExecutionContext,
    table: core.Table,
    recordId: core.RecordId,
    mutateSpec: core.ICellValueSpec,
    options?: core.UpdateOptions
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return safeTry<RecordMutationResult, DomainError>(
      async function* (this: PostgresTableRecordRepository) {
        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();
        const tableNameSplit = yield* dbTableName.split({ defaultSchema: 'public' });
        const physicalTableName = tableNameSplit.schema
          ? `${tableNameSplit.schema}.${tableNameSplit.tableName}`
          : tableNameSplit.tableName;
        const recordIdStr = recordId.toString();
        const actorId = context.actorId.toString();
        const actorContext = context as core.IExecutionContext & {
          actorName?: string;
          actorEmail?: string;
        };
        const now = new Date().toISOString();

        // Use transaction-aware database connection
        const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
        const actorIdentity = await this.resolveUpdateActorIdentity(
          context,
          table,
          actorId,
          actorContext
        );

        // Use RecordUpdateBuilder to build all SQL statements from mutateSpec
        const updateBuilder = new RecordUpdateBuilder(db);
        const { setClauses, changedFieldIds, additionalStatements, impact, linkedRecordLocks } =
          yield* await updateBuilder.buildMutationPlan({
            table,
            tableName,
            mutateSpec,
            recordId: recordIdStr,
            context: {
              actorId,
              now,
              actorName: actorIdentity.actorName,
              actorEmail: actorIdentity.actorEmail,
              ...(options?.fillLinkTitles ? { fillLinkTitles: true } : {}),
              ...(options?.fillLinkTitleForeignTables
                ? { fillLinkTitleForeignTables: options.fillLinkTitleForeignTables }
                : {}),
            },
          });
        const { impactHint, extraSeedRecords, exclusivityConstraints } = impact;
        const writtenLinkFields = yield* collectWrittenLinkFields(
          table,
          new Set(Object.keys(setClauses))
        );
        if (writtenLinkFields.length > 0) yield* requireLinkWriteTransaction(db);
        const mutationImpact = {
          ...impactHint,
          linkFieldIds: writtenLinkFields.map((field) => field.id()),
        };
        const exclusivityState: LinkExclusivityValidationState = new Map();
        const extraSeedMap = new Map<
          string,
          { tableId: core.TableId; recordIds: Map<string, core.RecordId> }
        >();
        for (const seed of extraSeedRecords) {
          yield* mergeExtraSeedRecords(
            extraSeedMap,
            seed.tableId,
            seed.recordIds.map((id) => id.toString())
          );
        }
        const changedFieldColumns = yield* toChangedFieldColumns(table, changedFieldIds);
        let distinctUserFieldWhere = yield* buildDistinctUserFieldWhere(table, setClauses);
        for (const field of writtenLinkFields) {
          const foreignKey = yield* field.foreignKeyNameString();
          if (foreignKey === RECORD_ID_COLUMN || !Object.hasOwn(setClauses, foreignKey)) continue;
          const distinctForeignKey = sql<SqlBool>`${sql.ref(foreignKey)} IS DISTINCT FROM ${setClauses[foreignKey]}`;
          distinctUserFieldWhere = distinctUserFieldWhere
            ? sql<SqlBool>`((${distinctUserFieldWhere}) OR (${distinctForeignKey}))`
            : distinctForeignKey;
        }
        const normalizedImpact = this.normalizeImpactHint(mutationImpact);
        const expandedChangedFieldIds = this.expandComputedSeedFieldIds(
          table,
          mutationImpact.valueFieldIds.concat(mutationImpact.linkFieldIds)
        );
        const beforeImageCapturePlan = yield* await this.resolveBeforeImageCapturePlan(
          context,
          table,
          expandedChangedFieldIds,
          'update',
          normalizedImpact
        );

        let snapshotCaptureSession: IPostgresRecordMutationSnapshotCaptureSession | undefined;
        try {
          snapshotCaptureSession = yield* await this.recordMutationSnapshotCapture.begin(
            toRecordMutationSnapshotTraceContext(context),
            db,
            tableName,
            foreignLinkCaptureTables(exclusivityConstraints)
          );

          let updateQuery = db
            .updateTable(tableName)
            .set(setClauses)
            .where(RECORD_ID_COLUMN, '=', recordIdStr);
          if (options?.expectedVersion != null) {
            updateQuery = updateQuery.where(VERSION_COLUMN, '=', options.expectedVersion);
          }
          if (distinctUserFieldWhere) {
            updateQuery = updateQuery.where(distinctUserFieldWhere);
          }
          const updatedRow =
            changedFieldColumns.length > 0
              ? ((await updateQuery
                  .returning(buildChangedFieldReturningSelects(changedFieldColumns))
                  .executeTakeFirst()) as Record<string, unknown> | undefined)
              : (await updateQuery.executeTakeFirst(), undefined);
          if (changedFieldColumns.length > 0 && !updatedRow) {
            await snapshotCaptureSession.abort();
            snapshotCaptureSession = undefined;
            return ok({ mutationApplied: false });
          }

          const writtenSourceIds = new Set([recordIdStr]);
          const currentManyManyLocks = yield* await collectCurrentManyManyTargetLocks(
            db,
            tableName,
            writtenLinkFields,
            writtenSourceIds
          );
          yield* await acquireLinkedRecordLocks(db, table.baseId().toString(), [
            ...linkedRecordLocks,
            ...currentManyManyLocks,
          ]);
          yield* await rememberLinkExclusivityIntents(
            db,
            exclusivityConstraints,
            table.id(),
            exclusivityState,
            writtenSourceIds,
            []
          );

          // Execute additional statements (junction table updates, FK updates)
          for (const stmt of additionalStatements) {
            await db.executeQuery(stmt.compiled);
          }

          const mutationRows = yield* await snapshotCaptureSession.finish();
          snapshotCaptureSession = undefined;
          yield* rememberCapturedLinkOwners(
            exclusivityState,
            mutationRows,
            buildWrittenLinkIntentKeys(exclusivityConstraints, writtenSourceIds)
          );
          if (exclusivityState.size > 0) {
            yield* rememberWrittenLinkOwners(
              table,
              physicalTableName,
              table.id(),
              new Map(
                Object.entries(setClauses).map(([column, value]) => [
                  column,
                  [{ recordId: recordIdStr, value }],
                ])
              ),
              writtenSourceIds,
              exclusivityState
            );
          }
          yield* mergeCapturedLinkSeeds(
            table,
            tableName,
            writtenLinkFields,
            mutationRows,
            extraSeedMap
          );
          yield* await validateLinkExclusivityFinalState(exclusivityState, db, extraSeedMap);
          const sourceMutationRows = mutationRows.filter((row) =>
            matchesUndoCaptureTableName(row.table_name, tableName)
          );
          const updateSnapshot = yield* buildRecordUpdateSnapshotFromUndoRows(
            table,
            sourceMutationRows,
            recordIdStr
          );
          if (!updateSnapshot) {
            this.logger.warn('record:snapshot:missing', {
              operation: 'update',
              tableId: table.id().toString(),
              recordIds: [recordIdStr],
              expectedCount: 1,
              actualCount: mutationRows.length,
            });
            return err(
              buildMissingSnapshotError('update', table.id().toString(), 1, mutationRows.length)
            );
          }
          const beforeImageRecord = beforeImageCapturePlan.needsBeforeImage
            ? buildBeforeImageFromTrackedValues(
                recordId,
                beforeImageCapturePlan.trackedFields,
                updateSnapshot.previous.fields
              )
            : undefined;

          // Run computed field updates
          const computedResult = yield* await this.runComputedUpdateById(
            context,
            table,
            recordId,
            'update',
            mutationImpact,
            finalizeExtraSeedRecords(extraSeedMap),
            beforeImageRecord ? [beforeImageRecord] : []
          );
          // Extract computed changes for this specific record
          await this.touchTableMeta(context, table.id().toString(), actorId);
          const computedChanges = extractChangesForRecord(computedResult, recordIdStr);
          const changedFields = toChangedFieldsMap(updatedRow, changedFieldColumns);
          return ok({ mutationApplied: true, changedFields, computedChanges, updateSnapshot });
        } catch (error) {
          await snapshotCaptureSession?.abort();
          return err(
            wrapDatabaseError(error, 'update', {
              tableName,
              recordId: recordIdStr,
              fields: table.getFields(),
            })
          );
        }
      }.bind(this)
    );
  }

  async updateMany(
    context: core.IExecutionContext,
    table: core.Table,
    spec: core.ISpecification<core.TableRecord, core.ITableRecordConditionSpecVisitor>,
    mutateSpec: core.ICellValueSpec,
    options?: core.UpdateOptions
  ): Promise<Result<core.UpdateManyResult, DomainError>> {
    return safeTry<core.UpdateManyResult, DomainError>(
      async function* (this: PostgresTableRecordRepository) {
        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();
        const actorId = context.actorId.toString();
        const actorContext = context as core.IExecutionContext & {
          actorName?: string;
          actorEmail?: string;
        };
        const now = new Date().toISOString();
        const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
        const skipComputed = options?.skipComputedUpdates ?? false;
        const deferComputed = !skipComputed && (options?.deferComputedUpdates ?? false);
        const enqueueDeferredComputedUpdates =
          deferComputed && (options?.enqueueDeferredComputedUpdates ?? false);
        const actorIdentity = await this.resolveUpdateActorIdentity(
          context,
          table,
          actorId,
          actorContext
        );

        const mutateVisitor = CellValueMutateVisitor.create(db, table, tableName, {
          recordId: '__bulk_update__',
          actorId,
          now,
          actorName: actorIdentity.actorName,
          actorEmail: actorIdentity.actorEmail,
          ...(options?.fillLinkTitles ? { fillLinkTitles: true } : {}),
          ...(options?.fillLinkTitleForeignTables
            ? { fillLinkTitleForeignTables: options.fillLinkTitleForeignTables }
            : {}),
        });

        yield* mutateSpec.accept(mutateVisitor);
        const statementsResult = mutateVisitor.build();
        if (statementsResult.isErr()) {
          return err(statementsResult.error);
        }

        const { setClauses, additionalStatements, changedFieldIds } =
          mutateVisitor.getSetClausesRaw();
        const valueFieldIds: core.FieldId[] = [];
        const linkFieldIds: core.FieldId[] = [];
        for (const fieldId of changedFieldIds) {
          const field = yield* table.getField((candidate) => candidate.id().equals(fieldId));
          if (field.type().equals(core.FieldType.link())) {
            linkFieldIds.push(fieldId);
          } else {
            valueFieldIds.push(fieldId);
          }
        }
        const impact = { valueFieldIds, linkFieldIds };
        const normalizedImpact = this.normalizeImpactHint(impact);
        if (additionalStatements.length > 0) {
          return err(
            core.domainError.notImplemented({
              code: 'record.bulk_update.additional_statements_not_supported',
              message: 'Bulk update by filter does not support relation or junction updates',
            })
          );
        }

        const whereExpression = yield* buildRecordWhereClause(spec);
        if (!whereExpression) {
          return err(
            core.domainError.validation({
              code: 'record.bulk_update.empty_filter',
              message: 'Bulk update filter cannot be empty',
            })
          );
        }

        const expandedChangedFieldIds = this.expandComputedSeedFieldIds(table, changedFieldIds);
        const beforeImageCapturePlan = yield* await this.resolveBeforeImageCapturePlan(
          context,
          table,
          expandedChangedFieldIds,
          'update',
          normalizedImpact
        );
        const changedTrackedFields = yield* toBulkUpdateTrackedFields(table, changedFieldIds);
        const trackedFields = mergeTrackedFields(
          changedTrackedFields,
          beforeImageCapturePlan.trackedFields
        );
        const distinctUserFieldWhere = yield* buildDistinctUserFieldWhere(table, setClauses);
        const filledLinkColumns = options?.fillLinkTitles
          ? yield* toChangedFieldColumns(table, linkFieldIds)
          : [];
        if (linkFieldIds.length > 0) yield* requireLinkWriteTransaction(db);

        // A deferred symmetric cache can lag its FK. Preserve the locked physical
        // owners from both sides of the update as seeds, together with the presented
        // old value, so reparenting refreshes both the previous and destination caches.
        const physicalLinkOwnerColumns: Array<{
          fieldId: string;
          columnName: string;
          oldAlias: string;
          newAlias: string;
        }> = [];
        for (const fieldId of linkFieldIds) {
          const field = yield* table.getField((candidate) => candidate.id().equals(fieldId));
          const linkField = field as core.LinkField;
          if (linkField.isOneWay()) continue;
          const columnName = yield* linkField.foreignKeyNameString();
          if (columnName === RECORD_ID_COLUMN) continue;
          physicalLinkOwnerColumns.push({
            fieldId: fieldId.toString(),
            columnName,
            oldAlias: `old_link_owner_${fieldId.toString()}`,
            newAlias: `new_link_owner_${fieldId.toString()}`,
          });
        }

        try {
          const matchedSelects = [
            sql.ref(RECORD_ID_COLUMN).as('matched_id'),
            sql.ref(VERSION_COLUMN).as('old_version'),
            ...trackedFields.map(({ dbFieldName, oldValueAlias }) =>
              sql.ref(dbFieldName).as(oldValueAlias)
            ),
            ...physicalLinkOwnerColumns.map(({ columnName, oldAlias }) =>
              sql.ref(columnName).as(oldAlias)
            ),
          ];

          const returningSelects = [
            sql.ref(RECORD_ID_COLUMN).as('record_id'),
            sql.ref(VERSION_COLUMN).as('new_version'),
            sql.ref('matched.old_version').as('old_version'),
            ...trackedFields.map(({ oldValueAlias }) =>
              sql.ref(`matched.${oldValueAlias}`).as(oldValueAlias)
            ),
            ...filledLinkColumns.map(({ dbFieldName, alias }) =>
              sql.ref(`${tableName}.${dbFieldName}`).as(alias)
            ),
            ...physicalLinkOwnerColumns.map(({ oldAlias }) =>
              sql.ref(`matched.${oldAlias}`).as(oldAlias)
            ),
            ...physicalLinkOwnerColumns.map(({ columnName, newAlias }) =>
              sql.ref(`${tableName}.${columnName}`).as(newAlias)
            ),
          ];

          let updateQuery = db
            .with('matched', (qb) => {
              const matched = qb
                .selectFrom(tableName)
                .select(matchedSelects)
                .where(whereExpression);
              // Read link before-images only after the same row lock as the UPDATE.
              return linkFieldIds.length > 0
                ? matched.orderBy(RECORD_ID_COLUMN).forNoKeyUpdate()
                : matched;
            })
            .updateTable(tableName)
            .from('matched')
            .set(setClauses)
            .whereRef(RECORD_ID_COLUMN, '=', 'matched.matched_id');
          if (distinctUserFieldWhere) {
            updateQuery = updateQuery.where(distinctUserFieldWhere);
          }
          const rows = await updateQuery.returning(returningSelects).execute();

          const updatedRecordIds: core.RecordId[] = [];
          const updatedRecords: Array<core.UpdateManyResult['updatedRecords'][number]> = [];
          const physicalLinkOwners = new Map<string, Set<string>>();
          for (const row of rows) {
            const rawId = row.record_id;
            if (typeof rawId !== 'string') {
              continue;
            }
            const recordIdResult = core.RecordId.create(rawId);
            if (recordIdResult.isOk()) {
              const oldFieldValues: Record<string, unknown> = {};
              for (const { fieldId, oldValueAlias } of trackedFields) {
                if (Object.prototype.hasOwnProperty.call(row, oldValueAlias)) {
                  oldFieldValues[fieldId.toString()] = row[oldValueAlias];
                }
              }
              for (const { fieldId, oldAlias, newAlias } of physicalLinkOwnerColumns) {
                const oldOwner = row[oldAlias];
                const newOwner = row[newAlias];
                if (typeof oldOwner !== 'string' && typeof newOwner !== 'string') continue;

                const owners = physicalLinkOwners.get(fieldId) ?? new Set<string>();
                if (typeof oldOwner === 'string') owners.add(oldOwner);
                if (typeof newOwner === 'string') owners.add(newOwner);
                physicalLinkOwners.set(fieldId, owners);
              }

              const oldVersion = Number(row.old_version);
              const newVersion = Number(row.new_version);
              const normalizedNewVersion = Number.isFinite(newVersion) ? newVersion : 0;
              const normalizedOldVersion = Number.isFinite(oldVersion)
                ? oldVersion
                : Math.max(normalizedNewVersion - 1, 0);
              updatedRecordIds.push(recordIdResult.value);
              updatedRecords.push({
                recordId: recordIdResult.value,
                oldVersion: normalizedOldVersion,
                newVersion: normalizedNewVersion,
                oldFieldValues,
                ...(filledLinkColumns.length > 0
                  ? { changedFields: toChangedFieldsMap(row, filledLinkColumns) }
                  : {}),
              });
            }
          }

          if (updatedRecordIds.length > 0 && changedFieldIds.length > 0 && !skipComputed) {
            const beforeImageRecords = beforeImageCapturePlan.needsBeforeImage
              ? updatedRecords.map((record) =>
                  beforeImageCapturePlan.trackedFields.length === 0
                    ? buildEmptyBeforeImageRecord(record.recordId)
                    : buildBeforeImageFromTrackedValues(
                        record.recordId,
                        beforeImageCapturePlan.trackedFields,
                        record.oldFieldValues
                      )
                )
              : [];
            const extraSeedRecords = yield* buildLinkExtraSeedRecords(
              table,
              linkFieldIds,
              updatedRecords,
              physicalLinkOwners
            );
            const computedResult = deferComputed
              ? enqueueDeferredComputedUpdates
                ? await this.runComputedUpdateManyByIds(
                    context,
                    table,
                    updatedRecordIds,
                    impact,
                    extraSeedRecords,
                    beforeImageRecords,
                    {
                      forceOutbox: true,
                      scheduleDispatchAfterCommit: true,
                      orchestration: options?.orchestration,
                    }
                  )
                : this.scheduleDeferredComputedUpdateManyByIds(
                    context,
                    table,
                    updatedRecordIds,
                    impact,
                    extraSeedRecords,
                    beforeImageRecords,
                    options?.orchestration
                  )
              : await this.runComputedUpdateManyByIds(
                  context,
                  table,
                  updatedRecordIds,
                  impact,
                  extraSeedRecords,
                  beforeImageRecords,
                  {
                    orchestration: options?.orchestration,
                  }
                );
            if (computedResult.isErr()) {
              return err(computedResult.error);
            }
          }

          if (updatedRecordIds.length > 0) {
            await this.touchTableMeta(context, table.id().toString(), actorId);
          }

          // Keep raw before-images for computation, then expose matching old/new presentation.
          presentUpdatedUserValues(table, updatedRecords);
          return ok({
            totalUpdated: updatedRecordIds.length,
            updatedRecordIds,
            updatedRecords,
          });
        } catch (error) {
          return err(
            wrapDatabaseError(error, 'update', {
              tableName,
              fields: table.getFields(),
            })
          );
        }
      }.bind(this)
    );
  }

  async updateManyStream(
    context: core.IExecutionContext,
    table: core.Table,
    batches:
      | Iterable<Result<core.UpdateManyStreamBatchInput, core.DomainError>>
      | AsyncIterable<Result<core.UpdateManyStreamBatchInput, core.DomainError>>,
    options?: core.UpdateManyStreamOptions
  ): Promise<Result<core.UpdateManyStreamResult, DomainError>> {
    return safeTry<core.UpdateManyStreamResult, DomainError>(
      async function* (this: PostgresTableRecordRepository) {
        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();
        const tableNameSplit = yield* dbTableName.split({ defaultSchema: 'public' });
        const physicalTableName = tableNameSplit.schema
          ? `${tableNameSplit.schema}.${tableNameSplit.tableName}`
          : tableNameSplit.tableName;
        const now = new Date().toISOString();
        const actorId = context.actorId.toString();
        const actorContext = context as core.IExecutionContext & {
          actorName?: string;
          actorEmail?: string;
        };
        const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;

        let totalUpdated = 0;
        let batchIndex = 0;
        const affectedRecordIds = new Map<string, core.RecordId>();
        const updatedRecords: Array<
          NonNullable<core.UpdateManyStreamResult['updatedRecords']>[number]
        > = [];
        const beforeImageByRecordId = new Map<string, ComputedBeforeImageRecord>();
        const allValueFieldIds = new Map<string, core.FieldId>();
        const allLinkFieldIds = new Map<string, core.FieldId>();
        const extraSeedMap = new Map<
          string,
          { tableId: core.TableId; recordIds: Map<string, core.RecordId> }
        >();
        const exclusivityState: LinkExclusivityValidationState = new Map();
        const localReleaseGenerations: LocalReleaseGenerations = new Map();
        const skipComputed = options?.skipComputedUpdates ?? false;
        const deferComputed = !skipComputed && (options?.deferComputedUpdates ?? false);
        const enqueueDeferredComputedUpdates =
          deferComputed && (options?.enqueueDeferredComputedUpdates ?? false);
        const actorIdentity = await this.resolveUpdateActorIdentity(
          context,
          table,
          actorId,
          actorContext
        );
        const normalizeBatch = (
          batch: core.UpdateManyStreamBatchInput
        ): { batchTable: core.Table; updates: ReadonlyArray<core.RecordUpdateResult> } =>
          core.isUpdateManyStreamBatch(batch)
            ? { batchTable: batch.table ?? table, updates: batch.updates }
            : { batchTable: table, updates: batch };

        const processBatch = async (
          batchResult: Result<core.UpdateManyStreamBatchInput, core.DomainError>
        ): Promise<
          Result<
            ReadonlyArray<NonNullable<core.UpdateManyStreamResult['updatedRecords']>[number]>,
            DomainError
          >
        > => {
          if (batchResult.isErr()) {
            return err(batchResult.error);
          }

          const { batchTable, updates: batch } = normalizeBatch(batchResult.value);
          if (batch.length === 0) {
            return ok([]);
          }

          const batchSpan = context.tracer?.startSpan(
            'teable.PostgresTableRecordRepository.updateManyStream.batch',
            {
              [core.TeableSpanAttributes.COMPONENT]: 'repository',
              [core.TeableSpanAttributes.OPERATION]:
                'PostgresTableRecordRepository.updateManyStream.batch',
              [core.TeableSpanAttributes.TABLE_ID]: batchTable.id().toString(),
              'record.update.batchIndex': batchIndex,
              'record.update.batchRecordCount': batch.length,
            }
          );

          // Convert batch to BatchRecordUpdateInput format
          const updates: Array<{ recordId: core.RecordId; mutateSpec: core.ICellValueSpec }> =
            batch.map((updateResult) => ({
              recordId: updateResult.record.id(),
              mutateSpec: updateResult.mutateSpec,
            }));

          const linkSourceIds = collectLinkUpdateSourceRecordIds(updates);
          if (linkSourceIds.isErr()) return err(linkSourceIds.error);
          const captureLinkMutations = linkSourceIds.value.length > 0;
          const requestedSystemFields = batchTable
            .getFields()
            .filter(
              (field) =>
                core.isLastModifiedSystemField(field) &&
                batch.some((update) => update.fieldKeyMapping.has(field.id().toString()))
            );
          // LastModified events need the OLD row actually overwritten after
          // any row-lock wait, not the statement-start matched CTE image.
          // Reuse the source trigger capture without adding relationship locks.
          // A later value-only batch can update an inverse target with a pending
          // release. Its trigger OLD tuple must extend the same local chain too.
          const capturePendingTargetMutations = [...exclusivityState.values()].some(
            (group) =>
              group.ownsForeignRows &&
              group.fkHostTableName === physicalTableName &&
              group.pendingNoopReleaseTokens.length > 0
          );
          const captureSourceMutations =
            captureLinkMutations ||
            requestedSystemFields.length > 0 ||
            capturePendingTargetMutations;
          if (captureLinkMutations) {
            const transaction = requireLinkWriteTransaction(db);
            if (transaction.isErr()) return err(transaction.error);
          }

          // Use BatchRecordUpdateBuilder to build batch update data
          const batchUpdateBuilder = new BatchRecordUpdateBuilder(db);
          const batchDataResult = await batchUpdateBuilder.buildBatchUpdateData({
            table: batchTable,
            tableName,
            updates,
            context: {
              actorId: context.actorId.toString(),
              now,
              actorName: actorIdentity.actorName,
              actorEmail: actorIdentity.actorEmail,
              ...(options?.fillLinkTitles ? { fillLinkTitles: true } : {}),
              ...(options?.fillLinkTitleForeignTables
                ? { fillLinkTitleForeignTables: options.fillLinkTitleForeignTables }
                : {}),
              ...(options?.assumeEmptyLinkState ? { assumeEmptyLinkState: true } : {}),
            },
          });
          if (batchDataResult.isErr()) {
            return err(batchDataResult.error);
          }

          const {
            columnUpdateData,
            additionalStatements,
            attachmentTableReplacements,
            linkedRecordLocks,
            impact,
            systemColumns,
          } = batchDataResult.value;
          const writtenLinkFields = collectWrittenLinkFields(
            batchTable,
            new Set(columnUpdateData.keys())
          );
          if (writtenLinkFields.isErr()) return err(writtenLinkFields.error);
          batchSpan?.setAttributes({
            'record.update.batchColumnCount': columnUpdateData.size,
            'record.update.batchAdditionalStatementCount': additionalStatements.length,
            'record.update.batchLinkedLockCount': linkedRecordLocks.length,
            'record.update.batchValueFieldCount': impact.valueFieldIds.length,
            'record.update.batchLinkFieldCount': impact.impactHint.linkFieldIds.length,
          });

          let snapshotCaptureSession: IPostgresRecordMutationSnapshotCaptureSession | undefined;
          try {
            const batchImpactHint = {
              valueFieldIds: impact.valueFieldIds,
              linkFieldIds: writtenLinkFields.value.map((field) => field.id()),
            };
            const normalizedBatchImpact = this.normalizeImpactHint(batchImpactHint);
            const batchChangedFieldIds = this.expandComputedSeedFieldIds(batchTable, [
              ...batchImpactHint.valueFieldIds,
              ...batchImpactHint.linkFieldIds,
            ]);
            const beforeImageCapturePlan = skipComputed
              ? ok<BeforeImageCapturePlan, DomainError>({
                  needsBeforeImage: false,
                  trackedFields: [],
                })
              : await this.resolveBeforeImageCapturePlan(
                  context,
                  batchTable,
                  batchChangedFieldIds,
                  'update',
                  normalizedBatchImpact
                );
            if (beforeImageCapturePlan.isErr()) {
              return err(beforeImageCapturePlan.error);
            }

            const returnedOldSystemFields: Array<{ fieldId: string; dbFieldName: string }> = [];
            for (const field of requestedSystemFields) {
              const dbFieldNameResult = field.dbFieldName();
              if (dbFieldNameResult.isErr()) return err(dbFieldNameResult.error);
              const dbFieldNameValue = dbFieldNameResult.value.value();
              if (dbFieldNameValue.isErr()) return err(dbFieldNameValue.error);
              returnedOldSystemFields.push({
                fieldId: field.id().toString(),
                dbFieldName: dbFieldNameValue.value,
              });
            }
            // Generate and execute batch UPDATE SQL
            const returnedOldFields = collectBatchUpdateReturnedOldFields(
              batchTable,
              columnUpdateData,
              [
                ...beforeImageCapturePlan.value.trackedFields.map(({ fieldId, dbFieldName }) => ({
                  fieldId: fieldId.toString(),
                  dbFieldName,
                })),
                ...returnedOldSystemFields,
              ]
            );
            // Title filling is decided after link changes were pre-read. Return every
            // link cache column actually written by this statement, including a
            // typecast no-op whose persisted title is refreshed after a concurrent write.
            const filledLinkFieldIds = options?.fillLinkTitles
              ? new Set(batchImpactHint.linkFieldIds.map((fieldId) => fieldId.toString()))
              : undefined;
            const returnedNewFields = filledLinkFieldIds
              ? returnedOldFields
                  .filter(
                    ({ fieldId, dbFieldName }) =>
                      filledLinkFieldIds.has(fieldId) && columnUpdateData.has(dbFieldName)
                  )
                  .map(({ fieldId, dbFieldName }, index) => ({
                    fieldId,
                    dbFieldName,
                    alias: `new_${index}`,
                  }))
              : [];
            const updateSqlResult = buildBatchUpdateSql({
              tableName,
              columnUpdateData,
              systemColumns,
              table: batchTable,
              db,
              returnedOldFields,
              returnedNewFields,
              returnMatchedRecords: captureLinkMutations,
              noopReleaseSpecs: buildBatchNoopReleaseSpecs(impact.exclusivityConstraints),
            });
            if (updateSqlResult.isErr()) {
              return err(updateSqlResult.error);
            }
            batchSpan?.setAttributes({
              'record.update.batchSqlBytes': updateSqlResult.value.sql.length,
              'record.update.batchSqlParameterCount': updateSqlResult.value.parameters.length,
            });
            const batchLogContext = {
              tableId: batchTable.id().toString(),
              tableName,
              batchIndex,
              batchRecordCount: batch.length,
              batchColumnCount: columnUpdateData.size,
              batchAdditionalStatementCount: additionalStatements.length,
              batchLinkedLockCount: linkedRecordLocks.length,
              batchValueFieldCount: impact.valueFieldIds.length,
              batchLinkFieldCount: impact.impactHint.linkFieldIds.length,
              batchSqlBytes: updateSqlResult.value.sql.length,
              batchSqlParameterCount: updateSqlResult.value.parameters.length,
            };
            this.logger.debug(
              'PostgresTableRecordRepository.updateManyStream.batch',
              batchLogContext
            );
            if (
              batch.length >= 100 ||
              updateSqlResult.value.sql.length >= 50_000 ||
              linkedRecordLocks.length > 0 ||
              additionalStatements.length > 0
            ) {
              this.logger.info(
                'PostgresTableRecordRepository.updateManyStream.batchHeavy',
                batchLogContext
              );
            }

            if (captureSourceMutations) {
              const captureResult = await this.recordMutationSnapshotCapture.begin(
                toRecordMutationSnapshotTraceContext(context),
                db,
                tableName,
                foreignLinkCaptureTables(impact.exclusivityConstraints, exclusivityState)
              );
              if (captureResult.isErr()) return err(captureResult.error);
              snapshotCaptureSession = captureResult.value;
            }

            const queryResult = await db.executeQuery(updateSqlResult.value);
            const batchUpdatedRecords: Array<
              NonNullable<core.UpdateManyStreamResult['updatedRecords']>[number]
            > = [];
            const unchangedSourceIds: string[] = [];
            const capturedNoopReleaseTokens: CapturedNoopReleaseToken[] = [];
            for (const row of queryResult.rows as ReadonlyArray<Record<string, unknown>>) {
              if (typeof row.release_group_key === 'string') {
                const tokenValues = [
                  row.release_source_id,
                  row.release_target_id,
                  row.release_owner_id,
                  row.release_xmin,
                  row.release_ctid,
                  row.release_relation_oid,
                  row.release_relation_filenode,
                ];
                if (!tokenValues.every((value) => typeof value === 'string')) {
                  return err(
                    domainError.infrastructure({
                      message: 'Invalid no-op link release token returned by batch update',
                      code: 'infrastructure.database.invalid_link_release_token',
                    })
                  );
                }
                capturedNoopReleaseTokens.push({
                  groupKey: row.release_group_key,
                  sourceRecordId: row.release_source_id as string,
                  targetRecordId: row.release_target_id as string,
                  ownerRecordId: row.release_owner_id as string,
                  xmin: row.release_xmin as string,
                  ctid: row.release_ctid as string,
                  relationOid: row.release_relation_oid as string,
                  relationFilenode: row.release_relation_filenode as string,
                });
                continue;
              }
              const rawId = row.record_id;
              if (typeof rawId !== 'string') {
                continue;
              }
              if (row.mutation_applied === false) {
                unchangedSourceIds.push(rawId);
                continue;
              }
              const recordIdResult = core.RecordId.create(rawId);
              if (recordIdResult.isErr()) {
                continue;
              }

              const rawVersion = Number(row.new_version);
              const rawOldVersion = Number(row.old_version);
              const oldFieldValues: Record<string, unknown> = {};
              for (const { fieldId, alias } of returnedOldFields) {
                if (Object.prototype.hasOwnProperty.call(row, alias)) {
                  oldFieldValues[fieldId] = row[alias];
                }
              }
              const newVersion = Number.isFinite(rawVersion) ? rawVersion : 0;
              const oldVersion = Number.isFinite(rawOldVersion)
                ? rawOldVersion
                : Math.max(newVersion - 1, 0);

              batchUpdatedRecords.push({
                recordId: recordIdResult.value,
                oldVersion,
                newVersion,
                oldFieldValues,
                ...(returnedNewFields.length > 0
                  ? {
                      changedFields: new Map(
                        returnedNewFields.map(({ fieldId, alias }) => {
                          const value = row[alias];
                          return [
                            fieldId,
                            Array.isArray(value) && value.length === 0 ? null : value,
                          ];
                        })
                      ),
                    }
                  : {}),
              });
            }

            const writtenRecordIds = new Set(
              batchUpdatedRecords.map(({ recordId }) => recordId.toString())
            );
            // Only rows seen by the mutation statement can be no-ops. A restored
            // ID that was missing in that statement must not acquire an intent.
            const existingSourceIds = new Set(writtenRecordIds);
            for (const id of unchangedSourceIds) {
              existingSourceIds.add(id);
            }
            const constraints = impact.exclusivityConstraints.filter((constraint) =>
              existingSourceIds.has(constraint.sourceRecordId)
            );
            // Matched no-ops contribute only their exact same-snapshot release tokens.
            // Their retained targets and claim statements are readonly observations.
            if (batchUpdatedRecords.length > 0 || constraints.length > 0) {
              const currentManyManyLocks =
                batchUpdatedRecords.length > 0
                  ? await collectCurrentManyManyTargetLocks(
                      db,
                      tableName,
                      writtenLinkFields.value,
                      writtenRecordIds,
                      columnUpdateData
                    )
                  : ok<LinkedRecordLockInfo[], DomainError>([]);
              if (currentManyManyLocks.isErr()) return err(currentManyManyLocks.error);
              const lockResult = await acquireLinkedRecordLocks(
                db,
                batchTable.baseId().toString(),
                [...linkedRecordLocks, ...currentManyManyLocks.value]
              );
              if (lockResult.isErr()) return err(lockResult.error);
              const intentResult = await rememberLinkExclusivityIntents(
                db,
                constraints,
                table.id(),
                exclusivityState,
                writtenRecordIds,
                capturedNoopReleaseTokens
              );
              if (intentResult.isErr()) return err(intentResult.error);
            }

            if (batchUpdatedRecords.length > 0) {
              // Execute additional statements (junction tables, FK updates)
              for (const stmt of additionalStatements) {
                if (stmt.sourceRecordId && !writtenRecordIds.has(stmt.sourceRecordId)) continue;
                await db.executeQuery(stmt.compiled);
              }
              const attachmentStatements = buildAttachmentTableBatchReplaceQueries(
                db,
                attachmentTableReplacements.filter(({ recordId }) => writtenRecordIds.has(recordId))
              );
              for (const statement of attachmentStatements) {
                await db.executeQuery(statement);
              }

              for (const update of batchUpdatedRecords) {
                affectedRecordIds.set(update.recordId.toString(), update.recordId);
              }
              // Preserve the same computed impact semantics as single-record updates.
              for (const fieldId of impact.valueFieldIds) {
                allValueFieldIds.set(fieldId.toString(), fieldId);
              }
              for (const fieldId of batchImpactHint.linkFieldIds) {
                allLinkFieldIds.set(fieldId.toString(), fieldId);
              }
              for (const seedGroup of impact.extraSeedRecords) {
                const mergeResult = mergeExtraSeedRecords(
                  extraSeedMap,
                  seedGroup.tableId,
                  seedGroup.recordIds.map((recordId) => recordId.toString())
                );
                if (mergeResult.isErr()) {
                  return err(mergeResult.error);
                }
              }
            }

            if (snapshotCaptureSession) {
              const captured = await snapshotCaptureSession.finish();
              snapshotCaptureSession = undefined;
              if (captured.isErr()) return err(captured.error);
              rememberCapturedLocalReleaseGenerations(
                exclusivityState,
                captured.value,
                localReleaseGenerations
              );
              const sourceRows = groupUndoLogRowsByRecordId(
                captured.value.filter(
                  (row) =>
                    row.operation === 'UPDATE' &&
                    matchesUndoCaptureTableName(row.table_name, tableName)
                )
              );
              for (const update of batchUpdatedRecords) {
                const oldRow = toStoredRowObject(
                  sourceRows.get(update.recordId.toString())?.[0]?.old_row
                );
                if (!oldRow || typeof oldRow[VERSION_COLUMN] !== 'number') {
                  return err(
                    buildMissingSnapshotError(
                      'update',
                      table.id().toString(),
                      batchUpdatedRecords.length,
                      sourceRows.size
                    )
                  );
                }
                update.oldVersion = Number(oldRow[VERSION_COLUMN]);
                update.oldFieldValues = Object.fromEntries(
                  returnedOldFields.map(({ fieldId, dbFieldName }) => [
                    fieldId,
                    oldRow[dbFieldName],
                  ])
                );
              }
              const ownerResult = rememberCapturedLinkOwners(
                exclusivityState,
                captured.value,
                buildWrittenLinkIntentKeys(constraints, writtenRecordIds)
              );
              if (ownerResult.isErr()) return err(ownerResult.error);
              const seedResult = mergeCapturedLinkSeeds(
                batchTable,
                tableName,
                writtenLinkFields.value,
                captured.value,
                extraSeedMap
              );
              if (seedResult.isErr()) return err(seedResult.error);
            }
            const writtenOwnersResult = rememberWrittenLinkOwners(
              batchTable,
              physicalTableName,
              table.id(),
              columnUpdateData,
              writtenRecordIds,
              exclusivityState
            );
            if (writtenOwnersResult.isErr()) return err(writtenOwnersResult.error);
            if (beforeImageCapturePlan.value.needsBeforeImage) {
              for (const update of batchUpdatedRecords) {
                const recordIdKey = update.recordId.toString();
                if (!beforeImageByRecordId.has(recordIdKey)) {
                  beforeImageByRecordId.set(
                    recordIdKey,
                    buildBeforeImageFromTrackedValues(
                      update.recordId,
                      beforeImageCapturePlan.value.trackedFields,
                      update.oldFieldValues
                    )
                  );
                }
              }
            }

            totalUpdated += batchUpdatedRecords.length;
            batchSpan?.setAttribute('record.update.batchUpdatedCount', batchUpdatedRecords.length);
            options?.onBatchUpdated?.({
              batchIndex,
              updatedCount: batchUpdatedRecords.length,
              totalUpdated,
            });
            batchIndex++;
            return ok(batchUpdatedRecords);
          } catch (error) {
            batchSpan?.recordError(describeError(error));
            return err(
              wrapDatabaseError(error, 'update', { tableName, fields: table.getFields() })
            );
          } finally {
            await snapshotCaptureSession?.abort();
            batchSpan?.end();
          }
        };

        if (Symbol.asyncIterator in batches) {
          for await (const batchResult of batches as AsyncIterable<
            Result<core.UpdateManyStreamBatchInput, core.DomainError>
          >) {
            const result = await processBatch(batchResult);
            if (result.isErr()) {
              return err(result.error);
            }
            updatedRecords.push(...result.value);
          }
        } else {
          for (const batchResult of batches as Iterable<
            Result<core.UpdateManyStreamBatchInput, core.DomainError>
          >) {
            const result = await processBatch(batchResult);
            if (result.isErr()) {
              return err(result.error);
            }
            updatedRecords.push(...result.value);
          }
        }

        const releaseResult = await applyPendingNoopLinkReleases(
          db,
          exclusivityState,
          affectedRecordIds,
          allLinkFieldIds,
          extraSeedMap,
          localReleaseGenerations
        );
        if (releaseResult.isErr()) return err(releaseResult.error);
        yield* await validateLinkExclusivityFinalState(exclusivityState, db, extraSeedMap);

        // Trigger computed field updates once after all batches
        if (affectedRecordIds.size > 0) {
          if (!skipComputed) {
            const affectedRecords = [...affectedRecordIds.values()];
            const impact = {
              valueFieldIds: [...allValueFieldIds.values()],
              linkFieldIds: [...allLinkFieldIds.values()],
            };
            const extraSeedRecords = finalizeExtraSeedRecords(extraSeedMap);
            const computedResult = deferComputed
              ? enqueueDeferredComputedUpdates
                ? await this.runComputedUpdateManyByIds(
                    context,
                    table,
                    affectedRecords,
                    impact,
                    extraSeedRecords,
                    [...beforeImageByRecordId.values()],
                    {
                      forceOutbox: true,
                      scheduleDispatchAfterCommit: true,
                      orchestration: options?.orchestration,
                    }
                  )
                : this.scheduleDeferredComputedUpdateManyByIds(
                    context,
                    table,
                    affectedRecords,
                    impact,
                    extraSeedRecords,
                    [...beforeImageByRecordId.values()],
                    options?.orchestration
                  )
              : await this.runComputedUpdateManyByIds(
                  context,
                  table,
                  affectedRecords,
                  impact,
                  extraSeedRecords,
                  [...beforeImageByRecordId.values()],
                  {
                    orchestration: options?.orchestration,
                  }
                );
            if (computedResult.isErr()) {
              return err(computedResult.error);
            }
          }
          await this.touchTableMeta(context, table.id().toString(), actorId);
        }

        presentUpdatedUserValues(table, updatedRecords);
        return ok({ totalUpdated, updatedRecords });
      }.bind(this)
    );
  }

  /**
   * Trigger computed updates for multiple records by IDs.
   * Used by updateManyStream to batch computed updates.
   */
  private async runComputedUpdateManyByIds(
    context: core.IExecutionContext,
    table: core.Table,
    recordIds: ReadonlyArray<core.RecordId>,
    impact: UpdateImpactHint | undefined,
    extraSeedRecords: ReadonlyArray<ExtraSeedRecordGroup> = [],
    beforeImageRecords: ReadonlyArray<ComputedBeforeImageRecord> = [],
    options: {
      readonly forceOutbox?: boolean;
      readonly scheduleDispatchAfterCommit?: boolean;
      readonly orchestration?: core.IBatchMutationOrchestration;
    } = {}
  ): Promise<Result<void, DomainError>> {
    const changedFieldIds = impact ? [...impact.valueFieldIds, ...impact.linkFieldIds] : [];
    const expandedChangedFieldIds = this.expandComputedSeedFieldIds(table, changedFieldIds);
    if (recordIds.length === 0 || expandedChangedFieldIds.length === 0) {
      return ok(undefined);
    }
    const normalizedImpact = this.normalizeImpactHint(impact);

    const shouldExecuteInline =
      !options.forceOutbox &&
      (this.computedUpdateStrategy.mode === 'sync' ||
        (this.computedUpdateStrategy.mode === 'hybrid' && recordIds.length === 1));

    if (shouldExecuteInline) {
      const planInput = {
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: [...recordIds],
        extraSeedRecords: extraSeedRecords.map((group) => ({
          tableId: group.tableId,
          recordIds: [...group.recordIds],
        })),
        beforeImageRecords: [...beforeImageRecords],
        changedFieldIds: [...expandedChangedFieldIds],
        changeType: 'update' as const,
        cyclePolicy: 'skip' as const,
        impact: normalizedImpact,
        table,
      };

      const planResult = await this.computedUpdatePlanner.planStage(planInput, context);
      if (planResult.isErr()) {
        this.logger.warn('computed:seed:plan_batch_failed', {
          error: planResult.error.message,
          tableId: table.id().toString(),
          recordCount: recordIds.length,
        });
        return err(planResult.error);
      }

      const plan = planResult.value;
      // Edge-only plans (delete/orphan propagation) are executable work.
      if (plan.steps.length === 0 && plan.edges.length === 0) {
        return ok(undefined);
      }

      const executeResult = await this.computedUpdateStrategy.execute(
        this.computedFieldUpdater,
        plan,
        context,
        { orchestration: options.orchestration }
      );
      if (executeResult.isErr()) {
        this.logger.warn('computed:seed:execute_batch_failed', {
          error: executeResult.error.message,
          tableId: table.id().toString(),
          recordCount: recordIds.length,
        });
        return err(executeResult.error);
      }

      // Hybrid owns publication for its synchronous prefix; only the sync strategy
      // returns changes without publishing them itself.
      if (this.computedUpdateStrategy.mode === 'sync') {
        await this.publishComputedUpdateEvents(
          context,
          table.baseId(),
          executeResult.value,
          resolveComputedRealtimeOrchestration(context, recordIds.length, options.orchestration)
        );
      }

      return ok(undefined);
    }

    // A one-record hybrid batch should match the single-record repository path so
    // seedTableOnly can make bounded computed values visible in the write response.
    // Larger and explicitly deferred batches stay plan-free here to preserve short
    // row-lock hold times; the worker plans them from the durable seed task.
    if (
      !this.shouldEnqueuePlanFreeSeed(table, expandedChangedFieldIds, 'update', normalizedImpact)
    ) {
      return ok(undefined);
    }

    const seedTask = buildSeedTaskInput({
      baseId: table.baseId(),
      seedTableId: table.id(),
      seedRecordIds: [...recordIds],
      extraSeedRecords: extraSeedRecords.map((group) => ({
        tableId: group.tableId,
        recordIds: [...group.recordIds],
      })),
      beforeImageRecords: [...beforeImageRecords],
      changedFieldIds: [...expandedChangedFieldIds],
      changeType: 'update',
      cyclePolicy: 'skip',
      impact: normalizedImpact,
      hasher: this.hasher,
      runId: context.requestId ?? generateUuid(),
      orchestration: resolveComputedRealtimeOrchestration(
        context,
        recordIds.length,
        options.orchestration
      ),
    });

    const enqueueResult = await this.enqueueAdmittedSeedTask(context, table, seedTask);
    if (enqueueResult.isErr()) {
      this.logger.warn('computed:seed:enqueue_batch_update_failed', {
        error: enqueueResult.error.message,
        tableId: table.id().toString(),
        recordCount: recordIds.length,
      });
      return err(enqueueResult.error);
    }

    this.logger.debug('computed:seed:enqueued_batch_update', {
      taskId: enqueueResult.value.taskId,
      merged: enqueueResult.value.merged,
      tableId: table.id().toString(),
      recordCount: recordIds.length,
      changedFieldCount: expandedChangedFieldIds.length,
    });

    if (options.scheduleDispatchAfterCommit) {
      const dispatchContext: core.IExecutionContext = { ...context };
      delete dispatchContext.transaction;
      const dispatch = () => this.computedUpdateStrategy.scheduleDispatch(dispatchContext);
      if (context.transaction?.afterCommit) {
        context.transaction.afterCommit(dispatch);
      } else {
        dispatch();
      }
    } else {
      this.computedUpdateStrategy.scheduleDispatch(context);
    }

    return ok(undefined);
  }

  private scheduleDeferredComputedUpdateManyByIds(
    context: core.IExecutionContext,
    table: core.Table,
    recordIds: ReadonlyArray<core.RecordId>,
    impact: UpdateImpactHint | undefined,
    extraSeedRecords: ReadonlyArray<ExtraSeedRecordGroup> = [],
    beforeImageRecords: ReadonlyArray<ComputedBeforeImageRecord> = [],
    orchestration?: core.IBatchMutationOrchestration | undefined
  ): Result<void, DomainError> {
    const computeContext: core.IExecutionContext = { ...context };
    delete computeContext.transaction;
    const run = () => {
      void this.runComputedUpdateManyByIds(
        computeContext,
        table,
        recordIds,
        impact,
        extraSeedRecords,
        beforeImageRecords,
        { orchestration }
      ).then((result) => {
        if (result.isErr()) {
          this.logger.warn('computed:deferred:update_many_by_ids_failed', {
            error: result.error.message,
            tableId: table.id().toString(),
            recordCount: recordIds.length,
          });
        }
      });
    };

    if (context.transaction?.afterCommit) {
      context.transaction.afterCommit(run);
    } else {
      run();
    }

    return ok(undefined);
  }

  // Re-persists archive snapshot rows (reason 'archived') during the redo replay of an
  // archive operation — write-ahead within the surrounding delete transaction.
  async insertArchiveTrashRows(
    context: core.IExecutionContext,
    table: core.Table,
    rows: ReadonlyArray<ArchiveTrashRowInput>
  ): Promise<Result<void, DomainError>> {
    if (rows.length === 0) {
      return ok(undefined);
    }

    try {
      const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
      await db
        .insertInto('record_trash')
        .values(
          rows.map((row) => ({
            id: generatePrefixedId(RECORD_TRASH_ID_PREFIX, RECORD_TRASH_ID_LENGTH),
            table_id: table.id().toString(),
            record_id: row.recordId,
            snapshot: row.snapshot,
            created_by: row.createdBy,
            created_time: new Date(row.createdTime),
            operation_id: row.operationId ?? null,
            reason: 'archived',
            record_created_time: row.recordCreatedTime ? new Date(row.recordCreatedTime) : null,
            record_created_by: row.recordCreatedBy ?? null,
            record_last_modified_time: row.recordLastModifiedTime
              ? new Date(row.recordLastModifiedTime)
              : null,
            record_last_modified_by: row.recordLastModifiedBy ?? null,
          }))
        )
        .execute();
      return ok(undefined);
    } catch (error) {
      return err(wrapDatabaseError(error, 'insert', { tableName: 'record_trash' }));
    }
  }

  // One-row table_trash index for restorePurgeGuard. Full recycle-bin JSON is
  // inserted later by the NestJS RecordsDeleted projection.
  async insertDeletedTrashRows(
    context: core.IExecutionContext,
    table: core.Table,
    input: DeletedTrashMarkerInput
  ): Promise<Result<void, DomainError>> {
    if (input.recordIds.length === 0) {
      return ok(undefined);
    }

    try {
      const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
      await db
        .insertInto('table_trash')
        .values({
          id: generatePrefixedId('opr', 16),
          table_id: table.id().toString(),
          resource_type: RECORD_TRASH_RESOURCE_TYPE,
          snapshot: JSON.stringify(input.recordIds),
          created_by: input.createdBy,
          created_time: new Date(input.createdTime),
        })
        .execute();
      return ok(undefined);
    } catch (error) {
      return err(wrapDatabaseError(error, 'insert', { tableName: 'table_trash' }));
    }
  }

  // Of the given ids, the ones that still hold a record_trash row with the given
  // reason — the undo-replay purge guard (see the port doc). Chunked to stay under
  // the bind-parameter limit on bulk-operation-sized id lists.
  async listTrashedRecordIds(
    context: core.IExecutionContext,
    table: core.Table,
    recordIds: ReadonlyArray<string>,
    reason: core.IRecordRemovalReason
  ): Promise<Result<ReadonlySet<string>, DomainError>> {
    const existing = new Set<string>();
    if (recordIds.length === 0) {
      return ok(existing);
    }

    try {
      const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
      const tableId = table.id().toString();
      const CHUNK = 5000;
      for (let index = 0; index < recordIds.length; index += CHUNK) {
        const rows = await db
          .selectFrom('record_trash')
          .select('record_id')
          .distinct()
          .where('table_id', '=', tableId)
          .where('reason', '=', reason)
          .where('record_id', 'in', recordIds.slice(index, index + CHUNK))
          .execute();
        for (const row of rows) {
          if (typeof row.record_id === 'string') {
            existing.add(row.record_id);
          }
        }
      }
      if (existing.size > 0 || reason !== RECORD_REMOVAL_REASON.Deleted) {
        return ok(existing);
      }

      const requested = new Set(recordIds);
      const tableTrashItems = await db
        .selectFrom('table_trash')
        .select('snapshot')
        .where('table_id', '=', tableId)
        .where('resource_type', '=', RECORD_TRASH_RESOURCE_TYPE)
        .execute();
      for (const item of tableTrashItems) {
        for (const recordId of parseTrashedRecordIds(item.snapshot)) {
          if (requested.has(recordId)) {
            existing.add(recordId);
          }
        }
      }
      return ok(existing);
    } catch (error) {
      return err(wrapDatabaseError(error, 'query', { tableName: 'record_trash' }));
    }
  }

  async listExistingRecordIds(
    context: core.IExecutionContext,
    table: core.Table,
    recordIds: ReadonlyArray<string>
  ): Promise<Result<ReadonlySet<string>, DomainError>> {
    const existing = new Set<string>();
    if (recordIds.length === 0) {
      return ok(existing);
    }

    const dbTableName = table.dbTableName();
    if (dbTableName.isErr()) {
      return err(dbTableName.error);
    }
    const tableName = dbTableName.value.value();
    if (tableName.isErr()) {
      return err(tableName.error);
    }

    try {
      const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
      const CHUNK = 5000;
      for (let index = 0; index < recordIds.length; index += CHUNK) {
        const rows = await db
          .selectFrom(tableName.value)
          .select(RECORD_ID_COLUMN)
          .where(RECORD_ID_COLUMN, 'in', recordIds.slice(index, index + CHUNK))
          .execute();
        for (const row of rows) {
          const recordId = row[RECORD_ID_COLUMN];
          if (typeof recordId === 'string') {
            existing.add(recordId);
          }
        }
      }
      return ok(existing);
    } catch (error) {
      return err(wrapDatabaseError(error, 'query', { tableName: tableName.value }));
    }
  }

  async deleteMany(
    context: core.IExecutionContext,
    table: core.Table,
    spec: core.ISpecification<core.TableRecord, core.ITableRecordConditionSpecVisitor>
  ): Promise<Result<DeleteManyResult, DomainError>> {
    return safeTry<DeleteManyResult, DomainError>(
      async function* (this: PostgresTableRecordRepository) {
        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();

        const whereVisitor = new TableRecordConditionWhereVisitor();
        const acceptResult = spec.accept(whereVisitor);
        if (acceptResult.isErr()) return err(acceptResult.error);
        const whereResult = whereVisitor.where();
        if (whereResult.isErr()) return err(whereResult.error);
        const whereClause = whereResult.value;

        // Use transaction-aware database connection
        const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
        const actorId = context.actorId.toString();
        const extraSeedMap = new Map<
          string,
          { tableId: core.TableId; recordIds: Map<string, core.RecordId> }
        >();

        const whereExpression = whereClause as unknown as Expression<SqlBool>;
        const deleteChangedFieldIds = table.getFields().map((field) => field.id());
        const beforeImageCapturePlan = yield* await this.resolveBeforeImageCapturePlan(
          context,
          table,
          deleteChangedFieldIds,
          'delete'
        );
        const recordRows = await db
          .selectFrom(tableName)
          .select([
            sql.ref(RECORD_ID_COLUMN).as('record_id'),
            ...beforeImageCapturePlan.trackedFields.map(({ dbFieldName, oldValueAlias }) =>
              sql.ref(dbFieldName).as(oldValueAlias)
            ),
          ])
          .where(whereExpression)
          .execute();

        const recordIds: core.RecordId[] = [];
        const recordIdStrings: string[] = [];
        const beforeImageRecords: ComputedBeforeImageRecord[] = [];
        for (const row of recordRows as BeforeImageTrackedRow[]) {
          const rawId = row.record_id;
          if (!rawId || typeof rawId !== 'string') {
            continue;
          }
          const recordIdResult = core.RecordId.create(rawId);
          if (recordIdResult.isErr()) return err(recordIdResult.error);
          recordIds.push(recordIdResult.value);
          recordIdStrings.push(rawId);
          if (!beforeImageCapturePlan.needsBeforeImage) {
            continue;
          }
          beforeImageRecords.push(
            beforeImageCapturePlan.trackedFields.length === 0
              ? buildEmptyBeforeImageRecord(recordIdResult.value)
              : buildBeforeImageFromTrackedValues(
                  recordIdResult.value,
                  beforeImageCapturePlan.trackedFields,
                  Object.fromEntries(
                    beforeImageCapturePlan.trackedFields.map(({ fieldId, oldValueAlias }) => [
                      fieldId.toString(),
                      row[oldValueAlias],
                    ])
                  )
                )
          );
        }

        if (recordIds.length === 0) {
          return err(
            core.domainError.notFound({
              code: 'record.not_found',
              message: 'No records matched the delete request',
              details: { tableId: table.id().toString() },
            })
          );
        }

        // Collect link field operations using visitor pattern
        const deleteVisitor = FieldDeleteValueVisitor.create({
          recordIds: recordIdStrings,
        });

        const linkFieldOps: OutgoingLinkDeletePlan[] = [];

        for (const field of table.getFields()) {
          const visitResult = field.accept(deleteVisitor);
          if (visitResult.isErr()) return err(visitResult.error);

          const { operation } = visitResult.value;
          if (operation && field.type().equals(core.FieldType.link())) {
            const linkField = field as core.LinkField;
            const linkedKeyName =
              operation.type === 'junction-delete'
                ? yield* linkField.foreignKeyNameString()
                : RECORD_ID_COLUMN;
            linkFieldOps.push({
              field: linkField,
              operation,
              linkedKeyName,
              seedColumns:
                operation.type === 'junction-delete'
                  ? [operation.selfKeyName, linkedKeyName]
                  : [operation.selfKeyName],
              cleanupColumns:
                operation.type === 'fk-nullify' && operation.orderColumnName
                  ? [operation.selfKeyName, operation.orderColumnName]
                  : [operation.selfKeyName],
            });
          }
        }

        // Discover every host before reading seeds so seed reads and cleanup share one
        // operation-local catalog snapshot. Metadata and physical data may use different DBs.
        const metaDb = this.resolveMetaDb(context);
        const incomingFieldsResult = await loadIncomingLinkFields(metaDb, table.id().toString());
        if (incomingFieldsResult.isErr()) return err(incomingFieldsResult.error);
        const incomingFields = incomingFieldsResult.value;
        const linkHostCatalog = yield* await loadLinkHostCatalog(db, [
          ...linkFieldOps.map(({ operation, seedColumns, cleanupColumns }) => ({
            hostTableName: operation.tableName,
            columnNames: [...seedColumns, ...cleanupColumns],
          })),
          ...incomingFields.map((field) => ({
            hostTableName: field.fkHostTableName,
            columnNames: incomingCleanupColumnNames(field),
          })),
        ]);
        const returningIncomingFieldIds = incomingReturningSeedFieldIds(
          incomingFields,
          tableName,
          table.id().toString()
        );

        // Capture all outgoing seeds before any cleanup can erase a shared/self-link.
        for (const plan of linkFieldOps) {
          const linkedIds = yield* await loadOutgoingLinkSeedIds(
            db,
            recordIdStrings,
            plan,
            linkHostCatalog,
            this.logger
          );
          const mergeResult = mergeExtraSeedRecords(
            extraSeedMap,
            plan.field.foreignTableId(),
            linkedIds
          );
          if (mergeResult.isErr()) return err(mergeResult.error);
        }

        // Shared hosts, required links, and self/symmetric links retain pre-cleanup seeds.
        const incomingSeedsResult = await collectIncomingLinkExtraSeedRecords(
          db,
          recordIdStrings,
          incomingFields,
          extraSeedMap,
          linkHostCatalog,
          returningIncomingFieldIds
        );
        if (incomingSeedsResult.isErr()) return err(incomingSeedsResult.error);

        // Execute incoming link cleanup (clean FK/junction pointing TO deleted records)
        const incomingCleanupResult = await executeIncomingLinkCleanup(
          db,
          recordIdStrings,
          incomingFields,
          tableName, // Pass target table name to skip symmetric link cleanup
          table.id().toString(), // Pass target table ID to detect self-referential links
          extraSeedMap,
          linkHostCatalog,
          returningIncomingFieldIds
        );
        if (incomingCleanupResult.isErr()) return err(incomingCleanupResult.error);

        // Execute all outgoing delete operations
        for (const plan of linkFieldOps) {
          const outgoingDeleteResult = await executeOutgoingLinkDeleteOp(
            db,
            recordIdStrings,
            plan,
            linkHostCatalog,
            this.logger
          );
          if (outgoingDeleteResult.isErr()) return err(outgoingDeleteResult.error);
        }

        let snapshotCaptureSession: IPostgresRecordMutationSnapshotCaptureSession | undefined;
        try {
          snapshotCaptureSession = yield* await this.recordMutationSnapshotCapture.begin(
            toRecordMutationSnapshotTraceContext(context),
            db,
            tableName
          );
          const deletedRows = (await db
            .deleteFrom(tableName)
            .where(whereExpression)
            .returningAll()
            .execute()) as Record<string, unknown>[];
          const mutationRows = yield* await snapshotCaptureSession.finish();
          const undoSnapshots = yield* buildStoredRecordSnapshotsFromDeletedUndoRows(
            table,
            mutationRows,
            recordIdStrings
          );
          const returningSnapshots = yield* buildStoredRecordSnapshotsByRows(table, deletedRows);
          const deletedSnapshots =
            returningSnapshots.length === recordIds.length
              ? returningSnapshots
              : undoSnapshots.length === recordIds.length
                ? undoSnapshots
                : returningSnapshots.length > 0
                  ? returningSnapshots
                  : undoSnapshots;
          if (deletedSnapshots.length !== recordIds.length) {
            this.logger.warn('record:snapshot:missing', {
              operation: 'delete',
              tableId: table.id().toString(),
              recordIds: recordIdStrings,
              expectedCount: recordIds.length,
              actualCount: deletedSnapshots.length,
            });
          }

          const computedResult = await this.runComputedDeleteUpdateMany(
            context,
            table,
            recordIds,
            finalizeExtraSeedRecords(extraSeedMap),
            beforeImageRecords
          );
          if (computedResult.isErr()) {
            return err(computedResult.error);
          }
          await this.touchTableMeta(context, table.id().toString(), actorId);
          return ok({ deletedRecords: deletedSnapshots });
        } catch (error) {
          await snapshotCaptureSession?.abort();
          if (isForeignKeyViolation(error)) {
            const located = await loadIncomingLinkDeleteError(metaDb, error);
            if (located) return err(located);
          }
          return err(
            wrapDatabaseError(error, 'delete', {
              tableName,
              count: recordIds.length,
              fields: table.getFields(),
            })
          );
        }
      }.bind(this)
    );
  }

  async deleteManyStream(
    context: core.IExecutionContext,
    table: core.Table,
    recordIdBatches:
      | Iterable<ReadonlyArray<core.RecordId>>
      | AsyncIterable<ReadonlyArray<core.RecordId>>,
    options?: core.DeleteManyStreamOptions
  ): Promise<Result<core.DeleteManyStreamResult, DomainError>> {
    let totalDeleted = 0;
    let batchIndex = 0;

    const deleteBatch = async (batchRecordIds: ReadonlyArray<core.RecordId>) => {
      const deleteResult = await this.deleteMany(
        context,
        table,
        core.RecordByIdsSpec.create(batchRecordIds)
      );
      if (deleteResult.isErr() && !core.isNotFoundError(deleteResult.error)) {
        return err(deleteResult.error);
      }

      totalDeleted += batchRecordIds.length;
      options?.onBatchDeleted?.({
        batchIndex,
        deletedCount: batchRecordIds.length,
        totalDeleted,
      });
      batchIndex += 1;
      return ok(undefined);
    };

    if (Symbol.asyncIterator in recordIdBatches) {
      for await (const batchRecordIds of recordIdBatches as AsyncIterable<
        ReadonlyArray<core.RecordId>
      >) {
        const deleteResult = await deleteBatch(batchRecordIds);
        if (deleteResult.isErr()) {
          return err(deleteResult.error);
        }
      }
    } else {
      for (const batchRecordIds of recordIdBatches as Iterable<ReadonlyArray<core.RecordId>>) {
        const deleteResult = await deleteBatch(batchRecordIds);
        if (deleteResult.isErr()) {
          return err(deleteResult.error);
        }
      }
    }

    return ok({ totalDeleted });
  }

  private async touchTableMeta(
    context: core.IExecutionContext,
    tableId: string,
    actorId: string
  ): Promise<void> {
    const db = this.resolveMetaDb(context);
    await db
      .withSchema('public')
      .updateTable('table_meta')
      .set({
        // Ensure monotonic millisecond progression for cache-key invalidation.
        // If multiple writes happen within the same millisecond, advance by 1ms.
        last_modified_time: sql<Date>`CASE
          WHEN "last_modified_time" IS NULL THEN CURRENT_TIMESTAMP
          ELSE GREATEST(CURRENT_TIMESTAMP, "last_modified_time" + interval '1 millisecond')
        END`,
        last_modified_by: actorId,
      })
      .where('id', '=', tableId)
      .execute();
  }

  private resolveMetaDb(context: core.IExecutionContext): Kysely<DynamicDB> {
    const scope = this.db === this.metaDb ? 'data' : 'meta';
    return resolvePostgresDbOrTx(this.metaDb, context, scope) as unknown as Kysely<DynamicDB>;
  }

  private async resolveActorIdentity(
    db: Kysely<DynamicDB>,
    actorId: string,
    actorContext: { actorName?: string; actorEmail?: string }
  ): Promise<ActorIdentity> {
    if (actorContext.actorName != null && actorContext.actorEmail != null) {
      return { actorName: actorContext.actorName, actorEmail: actorContext.actorEmail };
    }

    try {
      const row = await sql<{ name: string | null; email: string | null }>`
        SELECT u.name, u.email
        FROM public.users u
        WHERE u.id = ${actorId}::text
        LIMIT 1
      `.execute(db);

      const user = row.rows[0];
      if (!user) {
        return { actorName: actorContext.actorName, actorEmail: actorContext.actorEmail };
      }

      return {
        actorName: actorContext.actorName ?? user.name ?? undefined,
        actorEmail: actorContext.actorEmail ?? user.email ?? undefined,
      };
    } catch (error) {
      this.logger.warn('record:resolve_actor_identity_failed', {
        actorId,
        error: describeError(error),
      });
      return { actorName: actorContext.actorName, actorEmail: actorContext.actorEmail };
    }
  }

  private async runComputedUpdate(
    context: core.IExecutionContext,
    table: core.Table,
    record: core.TableRecord,
    changeType: 'insert' | 'update' | 'delete',
    impact: UpdateImpactHint | undefined = undefined,
    extraSeedRecords: ReadonlyArray<ExtraSeedRecordGroup> = [],
    beforeImageRecords: ReadonlyArray<ComputedBeforeImageRecord> = []
  ): Promise<Result<ComputedUpdateResult | undefined, DomainError>> {
    const changedFieldIdMap = new Map<string, core.FieldId>();
    for (const entry of record.fields().entries()) {
      changedFieldIdMap.set(entry.fieldId.toString(), entry.fieldId);
    }
    // For inserts, include ALL table fields as "changed" so formulas that
    // depend on fields not explicitly provided (which have null values) are
    // still computed — matching the batch insert path. Without this, a record
    // created with zero field values never computes any referenced formula.
    if (changeType === 'insert') {
      for (const field of table.getFields()) {
        if (field.type().equals(core.FieldType.link())) {
          continue;
        }
        const fieldId = field.id();
        changedFieldIdMap.set(fieldId.toString(), fieldId);
      }
    }
    const changedFieldIds = [...changedFieldIdMap.values()];
    const expandedChangedFieldIds = this.expandComputedSeedFieldIds(table, changedFieldIds, {
      includeZeroReferenceFormulas: changeType === 'insert',
    });

    // If no changed fields, nothing to compute
    if (expandedChangedFieldIds.length === 0) {
      return ok(undefined);
    }

    const normalizedImpact = this.normalizeImpactHint(impact);

    const shouldExecuteInline =
      this.computedUpdateStrategy.mode === 'sync' ||
      (this.computedUpdateStrategy.mode === 'hybrid' && changeType !== 'delete');

    // For sync mode and single-record hybrid writes, plan and execute directly before the undo snapshot is read.
    if (shouldExecuteInline) {
      const planInput = {
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: [record.id()],
        extraSeedRecords: extraSeedRecords.map((group) => ({
          tableId: group.tableId,
          recordIds: [...group.recordIds],
        })),
        beforeImageRecords: [...beforeImageRecords],
        changedFieldIds: expandedChangedFieldIds,
        changeType,
        cyclePolicy: 'skip' as const,
        impact: normalizedImpact
          ? {
              valueFieldIds: normalizedImpact.valueFieldIds,
              linkFieldIds: normalizedImpact.linkFieldIds,
            }
          : undefined,
        table,
      };

      const planResult = await withRepositoryTraceSpan(
        context,
        'runComputedUpdate.planStage',
        {
          [core.TeableSpanAttributes.TABLE_ID]: table.id().toString(),
          [core.TeableSpanAttributes.RECORD_ID]: record.id().toString(),
          'teable.computed.change_type': changeType,
          'teable.computed.changed_field_count': expandedChangedFieldIds.length,
          'teable.computed.strategy_mode': this.computedUpdateStrategy.mode,
        },
        () => this.computedUpdatePlanner.planStage(planInput, context)
      );
      if (planResult.isErr()) {
        this.logger.warn('computed:seed:plan_failed', {
          error: planResult.error.message,
          tableId: table.id().toString(),
          recordId: record.id().toString(),
        });
        return err(planResult.error);
      }

      const plan = planResult.value;
      // Edge-only plans (delete/orphan propagation) are executable work.
      if (plan.steps.length > 0 || plan.edges.length > 0) {
        const executeResult = await withRepositoryTraceSpan(
          context,
          'runComputedUpdate.execute',
          {
            [core.TeableSpanAttributes.TABLE_ID]: table.id().toString(),
            [core.TeableSpanAttributes.RECORD_ID]: record.id().toString(),
            'teable.computed.change_type': changeType,
            'teable.computed.plan_step_count': plan.steps.length,
            'teable.computed.plan_edge_count': plan.edges.length,
            'teable.computed.strategy_mode': this.computedUpdateStrategy.mode,
          },
          () => this.computedUpdateStrategy.execute(this.computedFieldUpdater, plan, context)
        );
        if (executeResult.isErr()) {
          this.logger.warn('computed:seed:execute_failed', {
            error: executeResult.error.message,
            tableId: table.id().toString(),
            recordId: record.id().toString(),
          });
          return err(executeResult.error);
        }
        if (this.computedUpdateStrategy.mode === 'sync') {
          await this.publishComputedUpdateEvents(
            context,
            table.baseId(),
            executeResult.value,
            resolveComputedRealtimeOrchestration(context, 1)
          );
        }
        return ok(executeResult.value);
      }

      return ok(undefined);
    }

    // For hybrid update/delete and async mode, use the outbox pattern.
    if (
      !this.shouldEnqueuePlanFreeSeed(table, expandedChangedFieldIds, changeType, normalizedImpact)
    ) {
      return ok(undefined);
    }

    // Build seed task input - only store minimal trigger information
    const seedTask = buildSeedTaskInput({
      baseId: table.baseId(),
      seedTableId: table.id(),
      seedRecordIds: [record.id()],
      extraSeedRecords: extraSeedRecords.map((group) => ({
        tableId: group.tableId,
        recordIds: [...group.recordIds],
      })),
      beforeImageRecords: [...beforeImageRecords],
      changedFieldIds: expandedChangedFieldIds,
      changeType,
      cyclePolicy: 'skip',
      impact: normalizedImpact
        ? {
            valueFieldIds: normalizedImpact.valueFieldIds,
            linkFieldIds: normalizedImpact.linkFieldIds,
          }
        : undefined,
      hasher: this.hasher,
      runId: context.requestId ?? generateUuid(),
      orchestration: resolveComputedRealtimeOrchestration(context, 1),
    });

    // Enqueue seed task - plan computation and execution happens asynchronously in the worker
    const enqueueResult = await this.enqueueAdmittedSeedTask(context, table, seedTask);
    if (enqueueResult.isErr()) {
      this.logger.warn('computed:seed:enqueue_failed', {
        error: enqueueResult.error.message,
        tableId: table.id().toString(),
        recordId: record.id().toString(),
        changeType,
      });
      return err(enqueueResult.error);
    }

    this.logger.debug('computed:seed:enqueued', {
      taskId: enqueueResult.value.taskId,
      merged: enqueueResult.value.merged,
      tableId: table.id().toString(),
      recordId: record.id().toString(),
      changeType,
      changedFieldCount: expandedChangedFieldIds.length,
    });

    // Schedule dispatch to process the enqueued task
    this.computedUpdateStrategy.scheduleDispatch(context);

    // Async mode doesn't return computed changes
    return ok(undefined);
  }

  private async runComputedUpdateMany(
    context: core.IExecutionContext,
    table: core.Table,
    records: ReadonlyArray<core.TableRecord>,
    changeType: 'insert' | 'update' | 'delete',
    extraSeedRecords: ReadonlyArray<ExtraSeedRecordGroup> = [],
    beforeImageRecords: ReadonlyArray<ComputedBeforeImageRecord> = [],
    options?: Pick<InsertOptions, 'allowPendingTableProvisionForComputedUpdates'> & {
      readonly orchestration?: core.IBatchMutationOrchestration;
    }
  ): Promise<Result<ComputedUpdateResult | undefined, DomainError>> {
    if (records.length === 0) return ok(undefined);
    const fieldIds = new Map<string, core.FieldId>();
    const recordIds: core.RecordId[] = [];

    for (const record of records) {
      recordIds.push(record.id());
      for (const entry of record.fields().entries()) {
        fieldIds.set(entry.fieldId.toString(), entry.fieldId);
      }
    }

    // For insert operations, include ALL fields from the table as "changed" fields.
    // This ensures formulas that depend on fields not explicitly provided (which have null values)
    // are still computed. For example, a formula like {textField} + '' should return ''
    // even if textField was not provided in the input.
    if (changeType === 'insert') {
      for (const field of table.getFields()) {
        if (field.type().equals(core.FieldType.link())) {
          continue;
        }
        const fieldId = field.id();
        fieldIds.set(fieldId.toString(), fieldId);
      }
    }

    const changedFieldIds = this.expandComputedSeedFieldIds(table, [...fieldIds.values()], {
      includeZeroReferenceFormulas: changeType === 'insert',
    });

    return this.runComputedUpdateManySeeds(
      context,
      table,
      recordIds,
      changedFieldIds,
      changeType,
      extraSeedRecords,
      beforeImageRecords,
      options
    );
  }

  private async runComputedUpdateManySeeds(
    context: core.IExecutionContext,
    table: core.Table,
    recordIds: core.RecordId[],
    changedFieldIds: core.FieldId[],
    changeType: 'insert' | 'update' | 'delete',
    extraSeedRecords: ReadonlyArray<ExtraSeedRecordGroup>,
    beforeImageRecords: ReadonlyArray<ComputedBeforeImageRecord>,
    options?: Pick<InsertOptions, 'allowPendingTableProvisionForComputedUpdates'> & {
      readonly orchestration?: core.IBatchMutationOrchestration | undefined;
    },
    realtimeRecordCount = recordIds.length
  ): Promise<Result<ComputedUpdateResult | undefined, DomainError>> {
    // If no changed fields, nothing to compute
    if (changedFieldIds.length === 0) {
      return ok(undefined);
    }

    const shouldExecuteInline =
      this.computedUpdateStrategy.mode === 'sync' ||
      (this.computedUpdateStrategy.mode === 'hybrid' && changeType === 'insert');

    if (shouldExecuteInline) {
      const planInput = {
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: recordIds,
        extraSeedRecords: extraSeedRecords.map((group) => ({
          tableId: group.tableId,
          recordIds: [...group.recordIds],
        })),
        beforeImageRecords: [...beforeImageRecords],
        changedFieldIds,
        changeType,
        cyclePolicy: 'skip' as const,
        table,
      };

      const plannerOptions =
        changeType === 'insert' && options?.allowPendingTableProvisionForComputedUpdates === true
          ? ({ tableProvisionStates: ['ready', 'pending'] } as const)
          : undefined;
      const planResult = await this.computedUpdatePlanner.planStage(
        planInput,
        context,
        plannerOptions
      );
      if (planResult.isErr()) {
        this.logger.warn('computed:seed:plan_many_failed', {
          error: planResult.error.message,
          tableId: table.id().toString(),
          recordCount: recordIds.length,
        });
        return err(planResult.error);
      }

      const plan = planResult.value;
      // Edge-only plans (delete/orphan propagation) are executable work.
      if (plan.steps.length > 0 || plan.edges.length > 0) {
        const executeResult = await this.computedUpdateStrategy.execute(
          this.computedFieldUpdater,
          plan,
          context,
          { orchestration: options?.orchestration }
        );
        if (executeResult.isErr()) {
          this.logger.warn('computed:seed:execute_many_failed', {
            error: executeResult.error.message,
            tableId: table.id().toString(),
            recordCount: recordIds.length,
          });
          return err(executeResult.error);
        }
        if (this.computedUpdateStrategy.mode === 'sync') {
          await this.publishComputedUpdateEvents(
            context,
            table.baseId(),
            executeResult.value,
            resolveComputedRealtimeOrchestration(
              context,
              realtimeRecordCount,
              options?.orchestration
            )
          );
        }
        return ok(executeResult.value);
      }

      return ok(undefined);
    }

    // For hybrid update/delete and async mode, use the outbox pattern.
    if (!this.shouldEnqueuePlanFreeSeed(table, changedFieldIds, changeType)) {
      return ok(undefined);
    }

    // Build seed task input - only store minimal trigger information
    const seedTask = buildSeedTaskInput({
      baseId: table.baseId(),
      seedTableId: table.id(),
      seedRecordIds: recordIds,
      extraSeedRecords: extraSeedRecords.map((group) => ({
        tableId: group.tableId,
        recordIds: [...group.recordIds],
      })),
      beforeImageRecords: [...beforeImageRecords],
      changedFieldIds,
      changeType,
      cyclePolicy: 'skip',
      hasher: this.hasher,
      runId: context.requestId ?? generateUuid(),
      orchestration: resolveComputedRealtimeOrchestration(
        context,
        realtimeRecordCount,
        options?.orchestration
      ),
    });

    // Enqueue seed task - plan computation and execution happens asynchronously in the worker
    const enqueueResult = await this.enqueueAdmittedSeedTask(context, table, seedTask);
    if (enqueueResult.isErr()) {
      this.logger.warn('computed:seed:enqueue_many_failed', {
        error: enqueueResult.error.message,
        tableId: table.id().toString(),
        recordCount: recordIds.length,
        changeType,
      });
      return err(enqueueResult.error);
    }

    this.logger.debug('computed:seed:enqueued_many', {
      taskId: enqueueResult.value.taskId,
      merged: enqueueResult.value.merged,
      tableId: table.id().toString(),
      recordCount: recordIds.length,
      changeType,
      changedFieldCount: changedFieldIds.length,
    });

    // Schedule dispatch to process the enqueued task
    this.computedUpdateStrategy.scheduleDispatch(context);

    // Async mode doesn't return computed changes
    return ok(undefined);
  }

  private async runComputedUpdateById(
    context: core.IExecutionContext,
    table: core.Table,
    recordId: core.RecordId,
    changeType: 'insert' | 'update' | 'delete',
    impact: UpdateImpactHint | undefined = undefined,
    extraSeedRecords: ReadonlyArray<ExtraSeedRecordGroup> = [],
    beforeImageRecords: ReadonlyArray<ComputedBeforeImageRecord> = []
  ): Promise<Result<ComputedUpdateResult | undefined, DomainError>> {
    // Get changed field IDs from impact hint (value fields + link fields)
    const changedFieldIds: core.FieldId[] = [];
    if (impact) {
      changedFieldIds.push(...impact.valueFieldIds, ...impact.linkFieldIds);
    }
    const expandedChangedFieldIds = this.expandComputedSeedFieldIds(table, changedFieldIds);

    // If no changed fields, nothing to compute
    if (expandedChangedFieldIds.length === 0) {
      return ok(undefined);
    }

    const normalizedImpact = this.normalizeImpactHint(impact);

    const shouldExecuteInline =
      this.computedUpdateStrategy.mode === 'sync' ||
      (this.computedUpdateStrategy.mode === 'hybrid' && changeType !== 'delete');

    if (shouldExecuteInline) {
      const planInput = {
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: [recordId],
        extraSeedRecords: extraSeedRecords.map((group) => ({
          tableId: group.tableId,
          recordIds: [...group.recordIds],
        })),
        beforeImageRecords: [...beforeImageRecords],
        changedFieldIds: expandedChangedFieldIds,
        changeType,
        cyclePolicy: 'skip' as const,
        impact: normalizedImpact
          ? {
              valueFieldIds: normalizedImpact.valueFieldIds,
              linkFieldIds: normalizedImpact.linkFieldIds,
            }
          : undefined,
        table,
      };

      const planResult = await this.computedUpdatePlanner.planStage(planInput, context);
      if (planResult.isErr()) {
        this.logger.warn('computed:seed:plan_failed', {
          error: planResult.error.message,
          tableId: table.id().toString(),
          recordId: recordId.toString(),
        });
        return err(planResult.error);
      }

      const plan = planResult.value;
      // Edge-only plans (delete/orphan propagation) are executable work.
      if (plan.steps.length > 0 || plan.edges.length > 0) {
        const executeResult = await this.computedUpdateStrategy.execute(
          this.computedFieldUpdater,
          plan,
          context
        );
        if (executeResult.isErr()) {
          this.logger.warn('computed:seed:execute_failed', {
            error: executeResult.error.message,
            tableId: table.id().toString(),
            recordId: recordId.toString(),
          });
          return err(executeResult.error);
        }
        if (this.computedUpdateStrategy.mode === 'sync') {
          await this.publishComputedUpdateEvents(
            context,
            table.baseId(),
            executeResult.value,
            resolveComputedRealtimeOrchestration(context, 1)
          );
        }
        return ok(executeResult.value);
      }

      return ok(undefined);
    }

    // For hybrid update/delete and async mode, use the outbox pattern.
    if (
      !this.shouldEnqueuePlanFreeSeed(table, expandedChangedFieldIds, changeType, normalizedImpact)
    ) {
      return ok(undefined);
    }

    // Build seed task input - only store minimal trigger information
    const seedTask = buildSeedTaskInput({
      baseId: table.baseId(),
      seedTableId: table.id(),
      seedRecordIds: [recordId],
      extraSeedRecords: extraSeedRecords.map((group) => ({
        tableId: group.tableId,
        recordIds: [...group.recordIds],
      })),
      beforeImageRecords: [...beforeImageRecords],
      changedFieldIds: expandedChangedFieldIds,
      changeType,
      cyclePolicy: 'skip',
      impact: normalizedImpact
        ? {
            valueFieldIds: normalizedImpact.valueFieldIds,
            linkFieldIds: normalizedImpact.linkFieldIds,
          }
        : undefined,
      hasher: this.hasher,
      runId: context.requestId ?? generateUuid(),
      orchestration: resolveComputedRealtimeOrchestration(context, 1),
    });

    // Enqueue seed task - plan computation and execution happens asynchronously in the worker
    const enqueueResult = await this.enqueueAdmittedSeedTask(context, table, seedTask);
    if (enqueueResult.isErr()) {
      this.logger.warn('computed:seed:enqueue_failed', {
        error: enqueueResult.error.message,
        tableId: table.id().toString(),
        recordId: recordId.toString(),
      });
      return err(enqueueResult.error);
    }

    this.logger.debug('computed:seed:enqueued', {
      taskId: enqueueResult.value.taskId,
      merged: enqueueResult.value.merged,
      tableId: table.id().toString(),
      recordId: recordId.toString(),
      changedFieldIds: expandedChangedFieldIds.map((id) => id.toString()),
    });

    // Schedule dispatch to process the enqueued task
    this.computedUpdateStrategy.scheduleDispatch(context);

    // Async mode doesn't return computed changes
    return ok(undefined);
  }

  private async publishComputedUpdateEvents(
    context: core.IExecutionContext,
    baseId: core.BaseId,
    result: ComputedUpdateResult | undefined,
    orchestration?: core.IBatchMutationOrchestration | undefined
  ): Promise<void> {
    if (!result?.changesByStep.length) {
      return;
    }

    const events = buildComputedUpdateEvents(result.changesByStep, baseId, orchestration);
    if (!events.length) {
      return;
    }

    const publish = async () => {
      const publishResult = await this.eventBus.publishMany(
        core.withoutTransaction(context),
        events
      );
      if (publishResult.isErr()) {
        this.logger.warn('computed:events_publish_failed', {
          error: publishResult.error.message,
          eventCount: events.length,
        });
      }
    };

    if (core.registerAfterCommit(context, publish)) {
      return;
    }

    await publish();
  }

  private shouldEnqueuePlanFreeSeed(
    table: core.Table,
    changedFieldIds: ReadonlyArray<core.FieldId>,
    changeType: 'insert' | 'update' | 'delete',
    impact?: UpdateImpactHint
  ): boolean {
    const planner = this.computedUpdatePlanner as ComputedUpdatePlanner & {
      hasWritableComputedWork?: ComputedUpdatePlanner['hasWritableComputedWork'];
    };
    if (typeof planner.hasWritableComputedWork !== 'function') {
      return true;
    }
    const shouldEnqueue = planner.hasWritableComputedWork({
      baseId: table.baseId(),
      table,
      changedFieldIds,
      changeType,
      impact,
    });
    if (!shouldEnqueue) {
      this.logger.debug('computed:seed:skipped_no_work', {
        tableId: table.id().toString(),
        changeType,
        changedFieldCount: changedFieldIds.length,
      });
    }
    return shouldEnqueue;
  }

  private expandComputedSeedFieldIds(
    table: core.Table,
    changedFieldIds: ReadonlyArray<core.FieldId>,
    options?: { includeZeroReferenceFormulas?: boolean }
  ): core.FieldId[] {
    if (changedFieldIds.length === 0 && !options?.includeZeroReferenceFormulas) {
      return [];
    }

    const seedFieldIds = new Map<string, core.FieldId>();
    for (const fieldId of changedFieldIds) {
      seedFieldIds.set(fieldId.toString(), fieldId);
    }
    const changedSet = new Set(seedFieldIds.keys());

    for (const field of table.getFields()) {
      if (!field.computed().toBoolean()) {
        continue;
      }

      let dependsOnChangedField = field
        .dependencies()
        .some((depId) => changedSet.has(depId.toString()));

      if (!dependsOnChangedField && field instanceof core.FormulaField) {
        const refsResult = field.expression().getReferencedFieldIds();
        if (refsResult.isOk()) {
          dependsOnChangedField = refsResult.value.some((depId) =>
            changedSet.has(depId.toString())
          );
          // Formulas without field references (RECORD_ID(), AUTO_NUMBER(),
          // literals) depend only on the row existing. They never match a
          // changed-field set, so insert seeding must include them explicitly
          // or new records keep a null formula cell forever (T6520).
          if (
            !dependsOnChangedField &&
            options?.includeZeroReferenceFormulas &&
            refsResult.value.length === 0
          ) {
            dependsOnChangedField = true;
          }
        }
      }

      if (dependsOnChangedField) {
        const fieldId = field.id();
        seedFieldIds.set(fieldId.toString(), fieldId);
      }
    }

    return [...seedFieldIds.values()];
  }

  private normalizeImpactHint(impact?: UpdateImpactHint): UpdateImpactHint | undefined {
    if (!impact) {
      return undefined;
    }

    const valueFieldIds = new Map<string, core.FieldId>();
    for (const fieldId of impact.valueFieldIds) {
      valueFieldIds.set(fieldId.toString(), fieldId);
    }
    // Link value updates should propagate both link-relation and value semantics.
    for (const fieldId of impact.linkFieldIds) {
      valueFieldIds.set(fieldId.toString(), fieldId);
    }

    const linkFieldIds = new Map<string, core.FieldId>();
    for (const fieldId of impact.linkFieldIds) {
      linkFieldIds.set(fieldId.toString(), fieldId);
    }

    return {
      valueFieldIds: [...valueFieldIds.values()],
      linkFieldIds: [...linkFieldIds.values()],
    };
  }

  private async runComputedDeleteUpdateMany(
    context: core.IExecutionContext,
    table: core.Table,
    recordIds: ReadonlyArray<core.RecordId>,
    extraSeedRecords: ReadonlyArray<ExtraSeedRecordGroup> = [],
    beforeImageRecords: ReadonlyArray<ComputedBeforeImageRecord> = []
  ): Promise<Result<void, DomainError>> {
    if (recordIds.length === 0) return ok(undefined);
    const changedFieldIds = table.getFields().map((field) => field.id());

    // If no fields, nothing to compute
    if (changedFieldIds.length === 0) {
      return ok(undefined);
    }

    // For sync mode, plan and execute directly without using the outbox
    if (this.computedUpdateStrategy.mode === 'sync') {
      const planInput = {
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: [...recordIds],
        extraSeedRecords: extraSeedRecords.map((group) => ({
          tableId: group.tableId,
          recordIds: [...group.recordIds],
        })),
        beforeImageRecords: [...beforeImageRecords],
        changedFieldIds,
        changeType: 'delete' as const,
        cyclePolicy: 'skip' as const,
      };

      const planResult = await this.computedUpdatePlanner.planStage(planInput, context);
      if (planResult.isErr()) {
        this.logger.warn('computed:seed:plan_delete_many_failed', {
          error: planResult.error.message,
          tableId: table.id().toString(),
          recordCount: recordIds.length,
        });
        return err(planResult.error);
      }

      const plan = planResult.value;
      // Edge-only plans (delete/orphan propagation) are executable work.
      if (plan.steps.length > 0 || plan.edges.length > 0) {
        const executeResult = await this.computedUpdateStrategy.execute(
          this.computedFieldUpdater,
          plan,
          context
        );
        if (executeResult.isErr()) {
          this.logger.warn('computed:seed:execute_delete_many_failed', {
            error: executeResult.error.message,
            tableId: table.id().toString(),
            recordCount: recordIds.length,
          });
          return err(executeResult.error);
        }
      }

      return ok(undefined);
    }

    // For hybrid/async mode, use the outbox pattern
    if (!this.shouldEnqueuePlanFreeSeed(table, changedFieldIds, 'delete')) {
      return ok(undefined);
    }

    // Build seed task input - only store minimal trigger information
    const seedTask = buildSeedTaskInput({
      baseId: table.baseId(),
      seedTableId: table.id(),
      seedRecordIds: [...recordIds],
      extraSeedRecords: extraSeedRecords.map((group) => ({
        tableId: group.tableId,
        recordIds: [...group.recordIds],
      })),
      beforeImageRecords: [...beforeImageRecords],
      changedFieldIds,
      changeType: 'delete',
      cyclePolicy: 'skip',
      hasher: this.hasher,
      runId: context.requestId ?? generateUuid(),
      orchestration: resolveComputedRealtimeOrchestration(context, recordIds.length),
    });

    // Enqueue seed task - plan computation and execution happens asynchronously in the worker
    const enqueueResult = await this.enqueueAdmittedSeedTask(context, table, seedTask);
    if (enqueueResult.isErr()) {
      this.logger.warn('computed:seed:enqueue_delete_many_failed', {
        error: enqueueResult.error.message,
        tableId: table.id().toString(),
        recordCount: recordIds.length,
      });
      return err(enqueueResult.error);
    }

    this.logger.debug('computed:seed:enqueued_delete_many', {
      taskId: enqueueResult.value.taskId,
      merged: enqueueResult.value.merged,
      tableId: table.id().toString(),
      recordCount: recordIds.length,
      changedFieldCount: changedFieldIds.length,
    });

    // Schedule dispatch to process the enqueued task
    this.computedUpdateStrategy.scheduleDispatch(context);

    return ok(undefined);
  }
}

/**
 * Extract computed field changes for a specific record from ComputedUpdateResult.
 *
 * @param result - The computed update result (may be undefined for async mode)
 * @param recordId - The ID of the record to extract changes for
 * @returns A map of fieldId -> newValue, or undefined if no changes
 */
const buildComputedUpdateEvents = (
  changesByStep: ComputedUpdateResult['changesByStep'],
  baseId: core.BaseId,
  orchestration?: core.IBatchMutationOrchestration | undefined
): core.RecordsBatchUpdated[] => {
  if (changesByStep.length === 0) {
    return [];
  }

  const changesByTable = new Map<string, (typeof changesByStep)[number]['recordChanges']>();
  for (const stepChange of changesByStep) {
    const existing = changesByTable.get(stepChange.tableId) ?? [];
    changesByTable.set(stepChange.tableId, [...existing, ...stepChange.recordChanges]);
  }

  const events: core.RecordsBatchUpdated[] = [];

  for (const [tableIdStr, recordChanges] of changesByTable) {
    if (recordChanges.length === 0) {
      continue;
    }

    const tableIdResult = core.TableId.create(tableIdStr);
    if (tableIdResult.isErr()) {
      continue;
    }

    const updates = collapseRecordChangesByRecordId(recordChanges).map((change) => ({
      recordId: change.recordId,
      oldVersion: change.oldVersion,
      newVersion: change.newVersion ?? change.oldVersion + 1,
      changes: change.changes.map((fieldChange) => ({
        fieldId: fieldChange.fieldId,
        oldValue: fieldChange.oldValue,
        newValue: fieldChange.newValue,
      })),
    }));
    if (updates.length === 0) {
      continue;
    }

    events.push(
      core.RecordsBatchUpdated.create({
        tableId: tableIdResult.value,
        baseId,
        updates,
        source: 'computed',
        orchestration,
      })
    );
  }

  return events;
};

const resolveComputedRealtimeOrchestration = (
  context: core.IExecutionContext,
  recordCount: number,
  orchestration?: core.IBatchMutationOrchestration | undefined
): core.IBatchMutationOrchestration =>
  orchestration ?? core.buildOperationBatchMutation(context.requestId, recordCount);

const extractChangesForRecord = (
  result: ComputedUpdateResult | undefined,
  recordId: string
): ReadonlyMap<string, unknown> | undefined => {
  if (!result) return undefined;

  const changes = new Map<string, unknown>();
  for (const step of result.changesByStep) {
    for (const record of step.recordChanges) {
      if (record.recordId === recordId) {
        for (const change of record.changes) {
          changes.set(change.fieldId, change.newValue);
        }
      }
    }
  }
  return changes.size > 0 ? changes : undefined;
};

/**
 * Extract computed field changes for all records from ComputedUpdateResult.
 *
 * @param result - The computed update result (may be undefined for async mode)
 * @returns A map of recordId -> (fieldId -> newValue), or undefined if no changes
 */
const extractChangesForAllRecords = (
  result: ComputedUpdateResult | undefined
): ReadonlyMap<string, ReadonlyMap<string, unknown>> | undefined => {
  if (!result) return undefined;

  const changesByRecord = new Map<string, Map<string, unknown>>();
  for (const step of result.changesByStep) {
    for (const record of step.recordChanges) {
      let recordChanges = changesByRecord.get(record.recordId);
      if (!recordChanges) {
        recordChanges = new Map<string, unknown>();
        changesByRecord.set(record.recordId, recordChanges);
      }
      for (const change of record.changes) {
        recordChanges.set(change.fieldId, change.newValue);
      }
    }
  }
  return changesByRecord.size > 0 ? changesByRecord : undefined;
};

type OutgoingLinkDeletePlan = {
  field: core.LinkField;
  operation: OutgoingLinkDeleteOp;
  linkedKeyName: string;
  seedColumns: ReadonlyArray<string>;
  cleanupColumns: ReadonlyArray<string>;
};

type LinkHostCatalog = ReadonlyMap<string, ReadonlySet<string>>;

const linkHostTableKey = (tableName: string): string => {
  const { schemaName, plainTableName } = splitSchemaQualifiedTableName(tableName);
  return toQualifiedIdentifierLiteral(schemaName ?? 'public', plainTableName);
};

/**
 * Keep information_schema's table/column visibility rules, but fetch every requested
 * host in one round trip. Each operation still checks its own required columns.
 */
const loadLinkHostCatalog = async (
  db: Kysely<DynamicDB>,
  storage: ReadonlyArray<{ hostTableName: string; columnNames: ReadonlyArray<string> }>
): Promise<Result<LinkHostCatalog, DomainError>> => {
  const requested = new Map<
    string,
    { schemaName: string; tableName: string; columnNames: Set<string> }
  >();
  for (const { hostTableName, columnNames } of storage) {
    const key = linkHostTableKey(hostTableName);
    let host = requested.get(key);
    if (!host) {
      const { schemaName, plainTableName } = splitSchemaQualifiedTableName(hostTableName);
      host = {
        schemaName: schemaName ?? 'public',
        tableName: plainTableName,
        columnNames: new Set(),
      };
      requested.set(key, host);
    }
    for (const columnName of columnNames) {
      if (columnName.length > 0) host.columnNames.add(columnName);
    }
  }

  const catalog = new Map<string, Set<string>>();
  if (requested.size === 0) return ok(catalog);

  try {
    const hosts = [...requested].map(
      ([key, host]) =>
        sql`(${key}, ${host.schemaName}, ${host.tableName}, ARRAY[${sql.join(
          [...host.columnNames].map((columnName) => sql`${columnName}`)
        )}]::text[])`
    );
    const result = await sql<{ host_key: string; column_name: string | null }>`
      WITH requested(host_key, schema_name, table_name, column_names) AS (
        VALUES ${sql.join(hosts)}
      )
      SELECT requested.host_key, c.column_name
      FROM requested
      INNER JOIN information_schema.tables AS t
        ON t.table_schema = requested.schema_name AND t.table_name = requested.table_name
      LEFT JOIN information_schema.columns AS c
        ON c.table_schema = t.table_schema AND c.table_name = t.table_name
        AND c.column_name = ANY(requested.column_names)
    `.execute(db);
    for (const row of result.rows) {
      let columns = catalog.get(row.host_key);
      if (!columns) {
        columns = new Set();
        catalog.set(row.host_key, columns);
      }
      if (row.column_name !== null) columns.add(row.column_name);
    }
    return ok(catalog);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to check link host table existence: ${describeError(error)}`,
      })
    );
  }
};

const catalogHasTableAndColumns = (
  catalog: LinkHostCatalog,
  tableName: string,
  columnNames: ReadonlyArray<string>
): boolean => {
  const columns = catalog.get(linkHostTableKey(tableName));
  return columns !== undefined && columnNames.every((name) => !name || columns.has(name));
};

const isMissingRelationError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    code?: string;
    message?: string;
    cause?: unknown;
    originalError?: unknown;
    meta?: { code?: string; message?: string };
  };

  if (
    candidate.code === '42P01' ||
    candidate.code === '42703' ||
    candidate.meta?.code === '42P01' ||
    candidate.meta?.code === '42703'
  ) {
    return true;
  }

  const message = candidate.meta?.message ?? candidate.message;
  if (
    typeof message === 'string' &&
    message.includes('does not exist') &&
    (message.includes('relation') || message.includes('column'))
  ) {
    return true;
  }

  return isMissingRelationError(candidate.cause) || isMissingRelationError(candidate.originalError);
};

const isKyselyTransaction = (db: Kysely<DynamicDB>): boolean =>
  db instanceof Transaction || (db as { isTransaction?: boolean }).isTransaction === true;

const toIncomingLinkSavepointIdentifier = (fieldId: string, index: number): string => {
  const safeFieldId = fieldId.replaceAll(/\W/g, '_').slice(0, 40);
  return `"incoming_link_${index}_${safeFieldId}"`;
};

/**
 * Catching 42P01/42703 is not enough inside an open transaction: Postgres aborts
 * the whole txn, so the next statement becomes 25P02. Roll back to a savepoint
 * before skipping a missing host table or dropped FK column.
 */
const rollbackIncomingLinkSavepoint = async (
  db: Kysely<DynamicDB>,
  savepointIdentifier: string | undefined
): Promise<void> => {
  if (!savepointIdentifier) return;
  try {
    await sql.raw(`ROLLBACK TO SAVEPOINT ${savepointIdentifier}`).execute(db);
  } catch {
    // Keep the outer transaction usable when savepoint cleanup races.
  }
  try {
    await sql.raw(`RELEASE SAVEPOINT ${savepointIdentifier}`).execute(db);
  } catch {
    // Ignore release failures after rollback.
  }
};

const beginIncomingLinkSavepoint = async (
  db: Kysely<DynamicDB>,
  fieldId: string,
  index: number
): Promise<string | undefined> => {
  if (!isKyselyTransaction(db)) return undefined;
  const savepointIdentifier = toIncomingLinkSavepointIdentifier(fieldId, index);
  await sql.raw(`SAVEPOINT ${savepointIdentifier}`).execute(db);
  return savepointIdentifier;
};

const releaseIncomingLinkSavepoint = async (
  db: Kysely<DynamicDB>,
  savepointIdentifier: string | undefined
): Promise<void> => {
  if (!savepointIdentifier) return;
  try {
    await sql.raw(`RELEASE SAVEPOINT ${savepointIdentifier}`).execute(db);
  } catch {
    // Already rolled back or released.
  }
};

const warnMissingLinkHostTable = (
  logger: ILogger,
  params: {
    phase: 'load-existing' | 'cleanup-outgoing';
    field: core.LinkField;
    hostTableName: string;
    operationType: OutgoingLinkDeleteOp['type'];
    recordCount: number;
    error: unknown;
  }
) => {
  logger.warn('record:delete:missing_link_host_table', {
    phase: params.phase,
    fieldId: params.field.id().toString(),
    fieldName: params.field.name().toString(),
    relationship: params.field.relationship().toString(),
    hostTableName: params.hostTableName,
    operationType: params.operationType,
    recordCount: params.recordCount,
    error: describeError(params.error),
  });
};

const preflightOutgoingLinkHost = (
  catalog: LinkHostCatalog,
  plan: OutgoingLinkDeletePlan,
  logger: ILogger,
  phase: 'load-existing' | 'cleanup-outgoing',
  recordCount: number
): boolean => {
  const exists = catalogHasTableAndColumns(
    catalog,
    plan.operation.tableName,
    phase === 'load-existing' ? plan.seedColumns : plan.cleanupColumns
  );
  if (!exists) {
    warnMissingLinkHostTable(logger, {
      phase,
      field: plan.field,
      hostTableName: plan.operation.tableName,
      operationType: plan.operation.type,
      recordCount,
      error: 'preflight: link host table or column missing',
    });
  }
  return exists;
};

/**
 * Execute an outgoing link delete operation described by FieldDeleteValueVisitor.
 */
const executeOutgoingLinkDeleteOp = async (
  db: Kysely<DynamicDB>,
  recordIds: ReadonlyArray<string>,
  plan: OutgoingLinkDeletePlan,
  catalog: LinkHostCatalog,
  logger: ILogger
): Promise<Result<void, DomainError>> => {
  if (recordIds.length === 0) return ok(undefined);
  if (!preflightOutgoingLinkHost(catalog, plan, logger, 'cleanup-outgoing', recordIds.length)) {
    return ok(undefined);
  }

  const { operation, field } = plan;
  let savepointIdentifier: string | undefined;
  let restoreSavepoint = false;
  try {
    // A positive catalog snapshot cannot guard against a concurrent DROP.
    savepointIdentifier = await beginIncomingLinkSavepoint(db, field.id().toString(), 0);
    if (operation.type === 'junction-delete') {
      await db
        .deleteFrom(operation.tableName)
        .where(operation.selfKeyName, 'in', recordIds as string[])
        .execute();
    } else if (operation.type === 'fk-nullify') {
      const updateValues: Record<string, null> = {
        [operation.selfKeyName]: null,
      };
      if (operation.orderColumnName) {
        updateValues[operation.orderColumnName] = null;
      }
      await db
        .updateTable(operation.tableName)
        .set(updateValues)
        .where(operation.selfKeyName, 'in', recordIds as string[])
        .execute();
    }
    return ok(undefined);
  } catch (error) {
    restoreSavepoint = true;
    await rollbackIncomingLinkSavepoint(db, savepointIdentifier);
    if (isMissingRelationError(error)) {
      warnMissingLinkHostTable(logger, {
        phase: 'cleanup-outgoing',
        field,
        hostTableName: operation.tableName,
        operationType: operation.type,
        recordCount: recordIds.length,
        error,
      });
      return ok(undefined);
    }
    return err(
      domainError.infrastructure({
        message: `Failed to clean outgoing link records: ${describeError(error)}`,
      })
    );
  } finally {
    if (!restoreSavepoint) {
      await releaseIncomingLinkSavepoint(db, savepointIdentifier);
    }
  }
};

/**
 * Load only distinct linked IDs for computed seeds; the source-to-target grouping
 * is irrelevant once all records in the delete batch contribute to the same seed set.
 */
const loadOutgoingLinkSeedIds = async (
  db: Kysely<DynamicDB>,
  recordIds: ReadonlyArray<string>,
  plan: OutgoingLinkDeletePlan,
  catalog: LinkHostCatalog,
  logger: ILogger
): Promise<Result<string[], DomainError>> => {
  if (recordIds.length === 0) return ok([]);
  if (!preflightOutgoingLinkHost(catalog, plan, logger, 'load-existing', recordIds.length)) {
    return ok([]);
  }

  const { operation, field, linkedKeyName } = plan;
  let savepointIdentifier: string | undefined;
  let restoreSavepoint = false;
  try {
    savepointIdentifier = await beginIncomingLinkSavepoint(db, field.id().toString(), 0);
    const rows = await db
      .selectFrom(operation.tableName)
      .select(sql.ref(linkedKeyName).as('linked_id'))
      .distinct()
      .where(operation.selfKeyName, 'in', recordIds as string[])
      .where(linkedKeyName, 'is not', null)
      .execute();
    return ok(
      rows.map((row) => row.linked_id).filter((id): id is string => typeof id === 'string')
    );
  } catch (error) {
    restoreSavepoint = true;
    await rollbackIncomingLinkSavepoint(db, savepointIdentifier);
    if (isMissingRelationError(error)) {
      warnMissingLinkHostTable(logger, {
        phase: 'load-existing',
        field,
        hostTableName: operation.tableName,
        operationType: operation.type,
        recordCount: recordIds.length,
        error,
      });
      return ok([]);
    }
    return err(
      domainError.infrastructure({
        message: `Failed to load outgoing link seed records: ${describeError(error)}`,
      })
    );
  } finally {
    if (!restoreSavepoint) {
      await releaseIncomingLinkSavepoint(db, savepointIdentifier);
    }
  }
};

const mergeExtraSeedRecords = (
  extraSeedMap: Map<string, { tableId: core.TableId; recordIds: Map<string, core.RecordId> }>,
  tableId: core.TableId,
  recordIds: ReadonlyArray<string>
): Result<void, DomainError> => {
  if (recordIds.length === 0) return ok(undefined);

  const entry =
    extraSeedMap.get(tableId.toString()) ??
    ({
      tableId,
      recordIds: new Map<string, core.RecordId>(),
    } as const);

  for (const recordId of recordIds) {
    const recordIdResult = core.RecordId.create(recordId);
    if (recordIdResult.isErr()) return err(recordIdResult.error);
    entry.recordIds.set(recordIdResult.value.toString(), recordIdResult.value);
  }

  extraSeedMap.set(tableId.toString(), entry);
  return ok(undefined);
};

const finalizeExtraSeedRecords = (
  extraSeedMap: Map<string, { tableId: core.TableId; recordIds: Map<string, core.RecordId> }>
): ExtraSeedRecordGroup[] => {
  return [...extraSeedMap.values()].map((entry) => ({
    tableId: entry.tableId,
    recordIds: [...entry.recordIds.values()],
  }));
};

const requireLinkWriteTransaction = (db: Kysely<DynamicDB>): Result<void, DomainError> =>
  isKyselyTransaction(db)
    ? ok(undefined)
    : err(
        domainError.infrastructure({
          message: 'Link writes require a data transaction',
          code: 'infrastructure.database.link_transaction_required',
        })
      );

const collectWrittenLinkFields = (
  table: core.Table,
  columnNames: ReadonlySet<string>
): Result<ReadonlyArray<core.LinkField>, DomainError> =>
  safeTry(function* () {
    const fields: core.LinkField[] = [];
    for (const field of table.getFields()) {
      if (!field.type().equals(core.FieldType.link())) continue;
      const column = yield* (yield* field.dbFieldName()).value();
      if (columnNames.has(column)) fields.push(field as core.LinkField);
    }
    return ok(fields);
  });

const foreignLinkCaptureTables = (
  constraints: ReadonlyArray<LinkExclusivityConstraint>,
  pendingState?: LinkExclusivityValidationState
): ReadonlyArray<string> => {
  const tables = new Set<string>();
  for (const constraint of constraints) {
    if (!constraint.usesJunctionTable && constraint.foreignKeyName === RECORD_ID_COLUMN) {
      tables.add(constraint.fkHostTableName);
    }
  }
  // finish() filters its returned rows by these table names. Include every
  // pending host so incidental writes cannot hide a new tuple incarnation.
  for (const group of pendingState?.values() ?? []) {
    if (group.ownsForeignRows && group.pendingNoopReleaseTokens.length > 0) {
      tables.add(group.fkHostTableName);
    }
  }
  return [...tables];
};

/** The AFTER trigger sees the exact physical target transition after any row-lock wait. */
const rememberCapturedLinkOwners = (
  state: LinkExclusivityValidationState,
  rows: ReadonlyArray<UndoLogRow>,
  writtenLinkIntentKeys: ReadonlySet<string>
): Result<void, DomainError> => {
  for (const group of state.values()) {
    if (!group.ownsForeignRows) continue;
    const desiredTargets = new Set([...group.authoritativeDesiredBySource.values()].flat());
    for (const row of rows) {
      if (
        row.operation !== 'UPDATE' ||
        !matchesUndoCaptureTableName(row.table_name, group.fkHostTableName)
      )
        continue;
      const oldRow = toStoredRowObject(row.old_row);
      const newRow = toStoredRowObject(row.new_row);
      if (!oldRow || !newRow || !Object.hasOwn(oldRow, group.selfKeyName)) {
        return err(buildMissingSnapshotError('update', group.sourceTableId.toString(), 1, 0));
      }
      const oldOwner =
        typeof oldRow[group.selfKeyName] === 'string'
          ? (oldRow[group.selfKeyName] as string)
          : null;
      const newOwner =
        typeof newRow[group.selfKeyName] === 'string'
          ? (newRow[group.selfKeyName] as string)
          : null;
      if (
        !desiredTargets.has(row.record_id) &&
        !group.initialOwnersByTarget.has(row.record_id) &&
        oldOwner === newOwner &&
        !(oldOwner && group.finalIntentBySource.has(oldOwner))
      )
        continue;
      if (!group.initialOwnersByTarget.has(row.record_id)) {
        group.initialOwnersByTarget.set(row.record_id, oldOwner ? [oldOwner] : null);
      }
      group.writtenOwnersByTarget.set(row.record_id, newOwner);
      if (oldOwner !== newOwner) {
        const transitions = group.ownershipTransitionsByTarget.get(row.record_id) ?? [];
        const sequence = ++group.provenanceSequence;
        transitions.push({ oldOwner, newOwner, sequence });
        group.ownershipTransitionsByTarget.set(row.record_id, transitions);
        const writtenDesired = oldOwner
          ? group.authoritativeDesiredBySource.get(oldOwner)
          : undefined;
        if (
          oldOwner &&
          newOwner === null &&
          writtenLinkIntentKeys.has(`${group.groupKey}\u0000${oldOwner}`) &&
          writtenDesired !== undefined &&
          !writtenDesired.includes(row.record_id)
        ) {
          const releasedOwners = group.writtenReleaseOwnersByTarget.get(row.record_id) ?? new Set();
          releasedOwners.add(oldOwner);
          group.writtenReleaseOwnersByTarget.set(row.record_id, releasedOwners);
        }
      }
    }
  }
  return ok(undefined);
};

const mergeCapturedLinkSeeds = (
  table: core.Table,
  tableName: string,
  fields: ReadonlyArray<core.LinkField>,
  rows: ReadonlyArray<UndoLogRow>,
  seeds: Map<string, { tableId: core.TableId; recordIds: Map<string, core.RecordId> }>
): Result<void, DomainError> =>
  safeTry(function* () {
    for (const field of fields) {
      if (field.isOneWay()) continue;
      const fieldColumn = yield* (yield* field.dbFieldName()).value();
      const foreignKey = yield* field.foreignKeyNameString();
      const selfKey = yield* field.selfKeyNameString();
      const host = yield* field.fkHostTableName().value();
      const foreignIds = new Set<string>();
      const ownerIds = new Set<string>();
      for (const row of rows) {
        if (row.operation !== 'UPDATE') continue;
        const oldRow = toStoredRowObject(row.old_row);
        const newRow = toStoredRowObject(row.new_row);
        if (!oldRow || !newRow) continue;
        if (matchesUndoCaptureTableName(row.table_name, tableName)) {
          for (const item of normalizeStoredLinkItems(oldRow[fieldColumn])) foreignIds.add(item.id);
          for (const item of normalizeStoredLinkItems(newRow[fieldColumn])) foreignIds.add(item.id);
        }
        // Both source images are authoritative after concurrent source writers.
        // A pre-read no-op can miss the actual old target and the destination's
        // seed; an explicit extra-seed group then suppresses symmetric traversal.
        // Keep the complete captured OLD/NEW target union for two-way links.
        if (field.relationship().toString() === 'manyMany') continue;
        if (!matchesUndoCaptureTableName(row.table_name, host)) continue;
        if (foreignKey !== RECORD_ID_COLUMN) {
          const oldOwner = oldRow[foreignKey];
          const newOwner = newRow[foreignKey];
          if (typeof oldOwner === 'string') foreignIds.add(oldOwner);
          if (typeof newOwner === 'string') foreignIds.add(newOwner);
        } else if (oldRow[selfKey] !== newRow[selfKey]) {
          foreignIds.add(row.record_id);
          const oldOwner = oldRow[selfKey];
          const newOwner = newRow[selfKey];
          if (typeof oldOwner === 'string') ownerIds.add(oldOwner);
          if (typeof newOwner === 'string') ownerIds.add(newOwner);
        }
      }
      yield* mergeExtraSeedRecords(seeds, field.foreignTableId(), [...foreignIds]);
      yield* mergeExtraSeedRecords(seeds, table.id(), [...ownerIds]);
    }
    return ok(undefined);
  });

/**
 * Reconcile two-way many-many target locks after the source UPDATE owns its row locks.
 * The source cache now holds the requested targets while the junction still holds the
 * previous physical targets, so their union closes a stale pre-read without changing
 * the existing source-row -> sorted target-advisory lock order.
 */
const collectCurrentManyManyTargetLocks = async (
  db: Kysely<DynamicDB>,
  tableName: string,
  fields: ReadonlyArray<core.LinkField>,
  writtenSourceIds: ReadonlySet<string>,
  sourceRecordsByColumn?: ReadonlyMap<string, ReadonlyArray<{ recordId: string; value: unknown }>>
): Promise<Result<LinkedRecordLockInfo[], DomainError>> => {
  if (writtenSourceIds.size === 0) return ok([]);

  return safeTry<LinkedRecordLockInfo[], DomainError>(async function* () {
    const locks: LinkedRecordLockInfo[] = [];

    for (const field of fields) {
      if (field.isOneWay() || field.relationship().toString() !== 'manyMany') continue;

      const fieldColumn = yield* (yield* field.dbFieldName()).value();
      const requestedSources = sourceRecordsByColumn?.get(fieldColumn);
      const sourceIds: string[] = [];
      if (requestedSources) {
        for (const source of requestedSources) {
          if (writtenSourceIds.has(source.recordId)) sourceIds.push(source.recordId);
        }
      } else {
        sourceIds.push(...writtenSourceIds);
      }
      if (sourceIds.length === 0) continue;

      const junctionTableName = yield* field.fkHostTableName().value();
      const selfKeyName = yield* field.selfKeyNameString();
      const foreignKeyName = yield* field.foreignKeyNameString();
      const foreignTableId = field.foreignTableId().toString();

      try {
        const sourceRows = await db
          .selectFrom(tableName)
          .select(sql.ref(fieldColumn).as('link_value'))
          .where(RECORD_ID_COLUMN, 'in', sourceIds)
          .execute();
        for (const row of sourceRows) {
          for (const item of normalizeStoredLinkItems(row.link_value)) {
            locks.push({ foreignTableId, foreignRecordId: item.id });
          }
        }

        const junctionRows = await db
          .selectFrom(junctionTableName)
          .select(sql.ref(foreignKeyName).as('linked_id'))
          .distinct()
          .where(selfKeyName, 'in', sourceIds)
          .where(foreignKeyName, 'is not', null)
          .execute();
        for (const row of junctionRows) {
          if (typeof row.linked_id !== 'string' || row.linked_id.length === 0) continue;
          locks.push({ foreignTableId, foreignRecordId: row.linked_id });
        }
      } catch (error) {
        return err(
          domainError.infrastructure({
            message: `Failed to collect current many-many target locks: ${describeError(error)}`,
          })
        );
      }
    }

    return ok(locks);
  });
};

const buildLinkedRecordLockKey = (
  baseId: string,
  foreignTableId: string,
  foreignRecordId: string
): string => `v2:link:${baseId}:${foreignTableId}:${foreignRecordId}`;

/**
 * Preserve existing target advisory coordination for updates and junction inserts.
 * Keys retain the caller-base scope for compatibility; they are not a canonical
 * cross-base physical relation gate. Sorting covers this call, not earlier writes
 * or later batches, and does not establish a transaction-wide deadlock guarantee.
 */
const acquireLinkedRecordLocks = async (
  db: Kysely<DynamicDB>,
  baseId: string,
  linkedRecordLocks: ReadonlyArray<LinkedRecordLockInfo>
): Promise<Result<void, DomainError>> => {
  if (linkedRecordLocks.length === 0) return ok(undefined);

  // Deduplicate and build lock keys
  const lockKeysSet = new Set<string>();
  for (const lock of linkedRecordLocks) {
    const key = buildLinkedRecordLockKey(baseId, lock.foreignTableId, lock.foreignRecordId);
    lockKeysSet.add(key);
  }

  // Keep a deterministic order within this target lock request.
  const lockKeys = [...lockKeysSet].sort((a, b) => Number(a > b) - Number(a < b));

  if (lockKeys.length === 0) return ok(undefined);

  // Acquire all locks in a single batch query
  // Format array as PostgreSQL array literal: ARRAY['key1', 'key2', ...]
  const arrayLiteral = `ARRAY[${lockKeys.map((k) => `'${k.replaceAll("'", "''")}'`).join(',')}]`;
  try {
    await db.executeQuery(
      sql`SELECT pg_advisory_xact_lock(('x' || substr(md5(k), 1, 16))::bit(64)::bigint)
          FROM unnest(${sql.raw(arrayLiteral)}::text[]) AS k
          ORDER BY k`.compile(db)
    );
    return ok(undefined);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to acquire linked record locks: ${describeError(error)}`,
      })
    );
  }
};

type CapturedNoopReleaseToken = {
  groupKey: string;
  sourceRecordId: string;
  targetRecordId: string;
  ownerRecordId: string;
  xmin: string;
  ctid: string;
  relationOid: string;
  relationFilenode: string;
};

type PendingNoopReleaseToken = CapturedNoopReleaseToken & {
  intentRevision: number;
  intentSequence: number;
};

type LinkOwnershipTransition = {
  oldOwner: string | null;
  newOwner: string | null;
  sequence: number;
};

type LinkExclusivityValidationGroup = {
  groupKey: string;
  fieldId: core.FieldId;
  sourceTableId: core.TableId;
  foreignTableId: core.TableId;
  fkHostTableName: string;
  selfKeyName: string;
  releaseOrderColumnName?: string;
  ownsForeignRows: boolean;
  finalIntentBySource: Map<
    string,
    {
      desiredTargetRecordIds: ReadonlyArray<string>;
      revision: number;
      sequence: number;
    }
  >;
  authoritativeDesiredBySource: Map<string, ReadonlyArray<string>>;
  releaseAuthorizedSourceIds: Set<string>;
  initialOwnersByTarget: Map<string, string[] | null>;
  writtenOwnersByTarget: Map<string, string | null>;
  inverseWrittenOwnersByTarget: Map<string, string | null>;
  ownershipTransitionsByTarget: Map<string, LinkOwnershipTransition[]>;
  writtenReleaseOwnersByTarget: Map<string, Set<string>>;
  noopReleaseOwnersByTarget: Map<string, Set<string>>;
  provenanceSequence: number;
  pendingNoopReleaseTokens: PendingNoopReleaseToken[];
};

type LinkExclusivityValidationState = Map<string, LinkExclusivityValidationGroup>;

const linkExclusivityGroupKey = (
  type: 'two-way' | 'one-way',
  fkHostTableName: string,
  selfKeyName: string,
  foreignKeyName: string,
  foreignTableId: core.TableId
): string =>
  JSON.stringify([type, fkHostTableName, selfKeyName, foreignKeyName, foreignTableId.toString()]);

const buildWrittenLinkIntentKeys = (
  constraints: ReadonlyArray<LinkExclusivityConstraint>,
  writtenSourceIds: ReadonlySet<string>
): Set<string> => {
  const keys = new Set<string>();
  for (const constraint of constraints) {
    if (!writtenSourceIds.has(constraint.sourceRecordId)) continue;
    const type =
      constraint.usesJunctionTable || constraint.foreignKeyName !== RECORD_ID_COLUMN
        ? 'one-way'
        : 'two-way';
    const groupKey = linkExclusivityGroupKey(
      type,
      constraint.fkHostTableName,
      constraint.selfKeyName,
      constraint.foreignKeyName,
      constraint.foreignTableId
    );
    keys.add(`${groupKey}\u0000${constraint.sourceRecordId}`);
  }
  return keys;
};

const buildBatchNoopReleaseSpecs = (
  constraints: ReadonlyArray<LinkExclusivityConstraint>
): BatchUpdateNoopReleaseSpec[] => {
  const specs = new Map<string, BatchUpdateNoopReleaseSpec>();
  for (const constraint of constraints) {
    if (constraint.usesJunctionTable || constraint.foreignKeyName !== RECORD_ID_COLUMN) continue;
    const groupKey = linkExclusivityGroupKey(
      'two-way',
      constraint.fkHostTableName,
      constraint.selfKeyName,
      constraint.foreignKeyName,
      constraint.foreignTableId
    );
    const spec: BatchUpdateNoopReleaseSpec = {
      groupKey,
      sourceRecordId: constraint.sourceRecordId,
      targetTableName: constraint.fkHostTableName,
      ownerColumnName: constraint.selfKeyName,
      desiredTargetRecordIds: constraint.desiredForeignRecordIds,
    };
    specs.set(`${groupKey}\u0000${constraint.sourceRecordId}`, spec);
  }
  return [...specs.values()];
};

/** An inverse assignment authorizes reparenting only when that exact FK row was written. */
const rememberWrittenLinkOwners = (
  table: core.Table,
  physicalTableName: string,
  physicalTableId: core.TableId,
  columnUpdateData: Map<string, Array<{ recordId: string; value: unknown }>>,
  writtenRecordIds: ReadonlySet<string>,
  state: LinkExclusivityValidationState
): Result<void, DomainError> =>
  safeTry<void, DomainError>(function* () {
    if (state.size === 0) return ok(undefined);
    for (const field of table.getFields()) {
      if (!field.type().equals(core.FieldType.link())) continue;
      const link = field as core.LinkField;
      const relationship = link.relationship().toString();
      if (link.isOneWay() || (relationship !== 'manyOne' && relationship !== 'oneOne')) continue;
      const foreignKeyName = yield* link.foreignKeyNameString();
      if (foreignKeyName === RECORD_ID_COLUMN) continue;
      const values = columnUpdateData.get(foreignKeyName);
      if (!values) continue;
      const selfKeyName = yield* link.selfKeyNameString();
      if (selfKeyName !== RECORD_ID_COLUMN) continue;
      const host = yield* link.fkHostTableName().split({ defaultSchema: 'public' });
      const hostTableName = host.schema ? `${host.schema}.${host.tableName}` : host.tableName;
      if (hostTableName !== physicalTableName) continue;
      const group = state.get(
        linkExclusivityGroupKey(
          'two-way',
          physicalTableName,
          foreignKeyName,
          RECORD_ID_COLUMN,
          physicalTableId
        )
      );
      if (!group || !group.sourceTableId.equals(link.foreignTableId())) continue;
      for (const { recordId, value } of values) {
        if (!writtenRecordIds.has(recordId) || (typeof value !== 'string' && value !== null)) {
          continue;
        }
        // Only an explicitly requested host-row FK UPDATE grants inverse-write
        // authority. Additional FK statements captured above are observations,
        // never authority for the collection-side claim that produced them.
        if (group.initialOwnersByTarget.has(recordId)) {
          group.writtenOwnersByTarget.set(recordId, value);
          group.inverseWrittenOwnersByTarget.set(recordId, value);
        }
      }
    }
    return ok(undefined);
  });

const buildNoopReleaseGenerationConflict = (
  group: LinkExclusivityValidationGroup,
  token: PendingNoopReleaseToken
): DomainError =>
  domainError.conflict({
    message: 'A linked record changed after its no-op repair snapshot was captured',
    code: 'conflict.link.noop_release_generation_changed',
    details: {
      fieldId: group.fieldId.toString(),
      sourceRecordId: token.sourceRecordId,
      targetRecordId: token.targetRecordId,
    },
  });

type LocalReleaseGenerations = Map<string, Set<string>>;

const releaseTupleGenerationKey = (tuple: UndoCaptureTupleIdentity): string =>
  JSON.stringify([tuple.xmin, tuple.ctid, tuple.relationOid, tuple.relationFilenode]);

/** Only the trigger OLD tuple proves that our UPDATE acquired this generation. */
const rememberCapturedLocalReleaseGenerations = (
  state: LinkExclusivityValidationState,
  rows: ReadonlyArray<UndoLogRow>,
  localGenerations: LocalReleaseGenerations
): void => {
  for (const row of rows) {
    if (!row.table_name || !row.record_id) continue;
    for (const group of state.values()) {
      if (
        !group.ownsForeignRows ||
        !matchesUndoCaptureTableName(row.table_name, group.fkHostTableName)
      )
        continue;
      const targetKey = `${group.fkHostTableName}\u0000${row.record_id}`;
      const tuple = row.operation === 'UPDATE' ? getUndoCaptureOldTuple(row) : undefined;
      // A deleted/recreated record is not the same chain. Legacy or incomplete
      // capture metadata must never preserve authorization across an unknown write.
      if (!tuple) {
        localGenerations.delete(targetKey);
        continue;
      }
      const generationKey = releaseTupleGenerationKey(tuple);
      for (const token of group.pendingNoopReleaseTokens) {
        if (
          token.targetRecordId !== row.record_id ||
          releaseTupleGenerationKey(token) !== generationKey
        )
          continue;
        const generations = localGenerations.get(targetKey) ?? new Set<string>();
        generations.add(generationKey);
        localGenerations.set(targetKey, generations);
      }
    }
  }
};

const applyPendingNoopLinkReleases = async (
  db: Kysely<DynamicDB>,
  state: LinkExclusivityValidationState,
  affectedRecordIds: Map<string, core.RecordId>,
  linkFieldIds: Map<string, core.FieldId>,
  extraSeedMap: Map<string, { tableId: core.TableId; recordIds: Map<string, core.RecordId> }>,
  localReleaseGenerations: ReadonlyMap<string, ReadonlySet<string>>
): Promise<Result<void, DomainError>> => {
  type ReleaseOperation = {
    group: LinkExclusivityValidationGroup;
    token: PendingNoopReleaseToken;
  };
  type TargetRelease = {
    targetTableName: string;
    targetRecordId: string;
    xmin: string;
    ctid: string;
    relationOid: string;
    relationFilenode: string;
    locallyChained: boolean;
    operations: Map<string, ReleaseOperation>;
  };

  // One physical row can host several inverse FK fields. Coordinate every field
  // captured from the same tuple generation into one UPDATE so our first repair
  // cannot invalidate a sibling field's ctid token.
  const releasesByTarget = new Map<string, TargetRelease>();
  for (const group of state.values()) {
    if (!group.ownsForeignRows) continue;
    for (const token of group.pendingNoopReleaseTokens) {
      const intent = group.finalIntentBySource.get(token.sourceRecordId);
      if (
        !intent ||
        intent.revision !== token.intentRevision ||
        intent.desiredTargetRecordIds.includes(token.targetRecordId)
      )
        continue;
      const transitions = group.ownershipTransitionsByTarget.get(token.targetRecordId) ?? [];
      const transferSatisfied =
        group.writtenOwnersByTarget.has(token.targetRecordId) &&
        group.writtenOwnersByTarget.get(token.targetRecordId) !== token.ownerRecordId &&
        transitions.some(({ oldOwner }) => oldOwner === token.ownerRecordId);
      if (transferSatisfied) continue;

      const operation = { group, token };
      const targetKey = `${group.fkHostTableName}\u0000${token.targetRecordId}`;
      const locallyChained =
        localReleaseGenerations.get(targetKey)?.has(releaseTupleGenerationKey(token)) ?? false;
      const existing = releasesByTarget.get(targetKey);
      if (existing) {
        if (
          existing.relationOid !== token.relationOid ||
          existing.relationFilenode !== token.relationFilenode ||
          (!existing.locallyChained &&
            !locallyChained &&
            (existing.xmin !== token.xmin || existing.ctid !== token.ctid))
        ) {
          return err(buildNoopReleaseGenerationConflict(group, token));
        }
        // Every unproven token still needs exact final CAS. Proven earlier local
        // generations may share the repair, but cannot waive a sibling token's CAS.
        if (existing.locallyChained && !locallyChained) {
          existing.xmin = token.xmin;
          existing.ctid = token.ctid;
          existing.locallyChained = false;
        }
        existing.operations.set(token.groupKey, operation);
      } else {
        releasesByTarget.set(targetKey, {
          targetTableName: group.fkHostTableName,
          targetRecordId: token.targetRecordId,
          xmin: token.xmin,
          ctid: token.ctid,
          relationOid: token.relationOid,
          relationFilenode: token.relationFilenode,
          locallyChained,
          operations: new Map([[token.groupKey, operation]]),
        });
      }
    }
  }

  const batches = new Map<string, TargetRelease[]>();
  for (const release of releasesByTarget.values()) {
    release.operations = new Map(
      [...release.operations].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    );
    const signature = JSON.stringify([
      release.targetTableName,
      release.locallyChained,
      [...release.operations].map(([groupKey, { group }]) => [
        groupKey,
        group.selfKeyName,
        group.releaseOrderColumnName ?? null,
      ]),
    ]);
    const batch = batches.get(signature) ?? [];
    batch.push(release);
    batches.set(signature, batch);
  }

  for (const releases of batches.values()) {
    const first = releases[0];
    if (!first) continue;
    const firstOperations = [...first.operations.values()];
    const assignmentColumns = new Set<string>();
    for (const { group } of firstOperations) {
      assignmentColumns.add(group.selfKeyName);
      if (group.releaseOrderColumnName) assignmentColumns.add(group.releaseOrderColumnName);
    }
    const assignments = sql.join(
      [...assignmentColumns].map((column) => sql`${sql.ref(column)} = NULL`),
      sql`, `
    );
    const ownerAliases = firstOperations.map((_, index) => `owner_${index}`);
    const valueAliases = [
      'target_id',
      ...ownerAliases,
      'tuple_xmin',
      'tuple_ctid',
      'relation_oid',
      'relation_filenode',
    ];
    const ownerPredicates = sql.join(
      firstOperations.map(
        ({ group }, index) =>
          sql`${sql.ref(`release_target.${group.selfKeyName}`)} = ${sql.ref(
            `release_token.owner_${index}`
          )}`
      ),
      sql` AND `
    );
    const tupleGenerationPredicate = first.locallyChained
      ? sql``
      : sql` AND release_target.xmin::text = ${sql.ref(
          'release_token.tuple_xmin'
        )} AND release_target.ctid = ${sql.ref('release_token.tuple_ctid')}::tid`;

    for (let offset = 0; offset < releases.length; offset += 500) {
      const chunk = releases.slice(offset, offset + 500);
      const values = sql.join(
        chunk.map((release) => {
          const operations = [...release.operations.values()];
          return sql`(${sql.join(
            [
              sql`${release.targetRecordId}`,
              ...operations.map(({ token }) => sql`${token.ownerRecordId}`),
              sql`${release.xmin}`,
              sql`${release.ctid}`,
              sql`${release.relationOid}`,
              sql`${release.relationFilenode}`,
            ],
            sql`, `
          )})`;
        }),
        sql`, `
      );
      try {
        const result = await db.executeQuery(
          sql`UPDATE ${sql.table(first.targetTableName)} AS release_target
              SET ${assignments}
              FROM (VALUES ${values}) AS release_token(${sql.join(
                valueAliases.map((alias) => sql.ref(alias)),
                sql`, `
              )})
              WHERE ${sql.ref(`release_target.${RECORD_ID_COLUMN}`)} = ${sql.ref('release_token.target_id')}
                AND ${ownerPredicates}
                ${tupleGenerationPredicate}
                AND release_target.tableoid::oid::text = ${sql.ref('release_token.relation_oid')}
                AND pg_relation_filenode(release_target.tableoid::regclass)::text = ${sql.ref('release_token.relation_filenode')}
              RETURNING ${sql.ref(`release_target.${RECORD_ID_COLUMN}`)} AS record_id`.compile(db)
        );
        const releasedIds = new Set(
          (result.rows as ReadonlyArray<Record<string, unknown>>)
            .map((row) => row.record_id)
            .filter((id): id is string => typeof id === 'string')
        );

        for (const release of chunk) {
          const operations = [...release.operations.values()];
          if (!releasedIds.has(release.targetRecordId)) {
            const operation = operations[0];
            if (operation)
              return err(buildNoopReleaseGenerationConflict(operation.group, operation.token));
            continue;
          }
          for (const { group, token } of operations) {
            if (!group.initialOwnersByTarget.has(token.targetRecordId)) {
              group.initialOwnersByTarget.set(token.targetRecordId, [token.ownerRecordId]);
            }
            group.writtenOwnersByTarget.set(token.targetRecordId, null);
            const transitions = group.ownershipTransitionsByTarget.get(token.targetRecordId) ?? [];
            const sequence = ++group.provenanceSequence;
            transitions.push({ oldOwner: token.ownerRecordId, newOwner: null, sequence });
            group.ownershipTransitionsByTarget.set(token.targetRecordId, transitions);
            const releasedOwners =
              group.noopReleaseOwnersByTarget.get(token.targetRecordId) ?? new Set<string>();
            releasedOwners.add(token.ownerRecordId);
            group.noopReleaseOwnersByTarget.set(token.targetRecordId, releasedOwners);
            const sourceId = core.RecordId.create(token.sourceRecordId);
            if (sourceId.isErr()) return err(sourceId.error);
            affectedRecordIds.set(token.sourceRecordId, sourceId.value);
            linkFieldIds.set(group.fieldId.toString(), group.fieldId);
            const foreignSeed = mergeExtraSeedRecords(extraSeedMap, group.foreignTableId, [
              token.targetRecordId,
            ]);
            if (foreignSeed.isErr()) return err(foreignSeed.error);
            const ownerSeed = mergeExtraSeedRecords(extraSeedMap, group.sourceTableId, [
              token.sourceRecordId,
            ]);
            if (ownerSeed.isErr()) return err(ownerSeed.error);
          }
        }
      } catch (error) {
        return err(
          domainError.infrastructure({
            message: `Failed to apply no-op link releases: ${describeError(error)}`,
            code: 'infrastructure.database.apply_link_release_failed',
          })
        );
      }
    }
  }
  return ok(undefined);
};

const validateLinkExclusivityFinalState = async (
  state: LinkExclusivityValidationState,
  persistedDb?: Kysely<DynamicDB>,
  extraSeedMap?: Map<string, { tableId: core.TableId; recordIds: Map<string, core.RecordId> }>
): Promise<Result<void, DomainError>> => {
  for (const group of state.values()) {
    const finalOwnerByTarget = new Map<string, string>();
    for (const [sourceRecordId, desiredIds] of group.authoritativeDesiredBySource) {
      for (const foreignRecordId of desiredIds) {
        const existingSourceId = finalOwnerByTarget.get(foreignRecordId);
        if (existingSourceId && existingSourceId !== sourceRecordId) {
          return err(
            domainError.validation({
              message:
                'Cannot link record(s): already linked by another record in the same batch. In one-to-many relationships, each record can only belong to one parent.',
              code: 'validation.link.batch_duplicate',
              localization: { i18nKey: sdkErrorI18nKeys.custom.linkBatchDuplicate },
              details: {
                fieldId: group.fieldId.toString(),
                foreignRecordId,
                conflictingSourceRecords: [existingSourceId, sourceRecordId],
              },
            })
          );
        }
        finalOwnerByTarget.set(foreignRecordId, sourceRecordId);
      }
    }

    const conflictingLinks: Array<{ recordId: string; linkedTo: string | null }> = [];
    const reparentedOwnerIds = new Set<string>();
    for (const [targetId, initialOwners] of group.initialOwnersByTarget) {
      const finalOwner =
        finalOwnerByTarget.get(targetId) ?? group.writtenOwnersByTarget.get(targetId) ?? undefined;
      for (const initialOwner of initialOwners ?? []) {
        if (initialOwner === finalOwner) continue;
        const intent = group.finalIntentBySource.get(initialOwner);
        const targetWasReleasedByIntent =
          !!intent && !intent.desiredTargetRecordIds.includes(targetId);
        const ownerTransitions = (group.ownershipTransitionsByTarget.get(targetId) ?? []).filter(
          ({ oldOwner }) => oldOwner === initialOwner
        );
        const exactTransition = ownerTransitions.length > 0;
        const exactInverseWrite =
          group.inverseWrittenOwnersByTarget.has(targetId) &&
          group.inverseWrittenOwnersByTarget.get(targetId) === (finalOwner ?? null);
        const writtenRelease =
          group.writtenReleaseOwnersByTarget.get(targetId)?.has(initialOwner) ?? false;
        const successfulNoopRelease =
          group.noopReleaseOwnersByTarget.get(targetId)?.has(initialOwner) ?? false;
        const tokenBeforeTransition = group.pendingNoopReleaseTokens.some(
          (token) =>
            token.sourceRecordId === initialOwner &&
            token.ownerRecordId === initialOwner &&
            token.targetRecordId === targetId &&
            token.intentRevision === intent?.revision &&
            ownerTransitions.some(({ sequence }) => sequence > token.intentSequence)
        );
        const transitionBeforeFinalReleaseIntent =
          !!intent && ownerTransitions.some(({ sequence }) => sequence < intent.sequence);
        const targetReleaseProvenance =
          targetWasReleasedByIntent &&
          (writtenRelease ||
            successfulNoopRelease ||
            tokenBeforeTransition ||
            transitionBeforeFinalReleaseIntent);
        const authorized = group.ownsForeignRows
          ? exactTransition && (targetReleaseProvenance || exactInverseWrite)
          : group.releaseAuthorizedSourceIds.has(initialOwner);
        if (authorized) reparentedOwnerIds.add(initialOwner);
        else conflictingLinks.push({ recordId: targetId, linkedTo: initialOwner });
      }
    }

    if (conflictingLinks.length === 0 && persistedDb && group.ownsForeignRows) {
      try {
        const targetIds = new Set([
          ...group.initialOwnersByTarget.keys(),
          ...finalOwnerByTarget.keys(),
        ]).values();
        for (;;) {
          const ids: string[] = [];
          while (ids.length < 500) {
            const next = targetIds.next();
            if (next.done) break;
            ids.push(next.value);
          }
          if (ids.length === 0) break;
          const rows = await persistedDb
            .selectFrom(group.fkHostTableName)
            .select([
              sql.ref(RECORD_ID_COLUMN).as('record_id'),
              sql.ref(group.selfKeyName).as('linked_to'),
            ])
            .where(RECORD_ID_COLUMN, 'in', ids)
            .execute();
          const foundIds = new Set(rows.map((row) => row.record_id as string));
          for (const id of ids) {
            if (!foundIds.has(id)) {
              return err(
                domainError.validation({
                  message: 'Cannot link record(s): a linked record no longer exists.',
                  code: 'validation.link.foreign_record_not_found',
                  details: { fieldId: group.fieldId.toString(), recordId: id },
                })
              );
            }
            if (finalOwnerByTarget.has(id) && !group.initialOwnersByTarget.has(id)) {
              return err(buildMissingSnapshotError('update', group.sourceTableId.toString(), 1, 0));
            }
          }
          for (const row of rows) {
            const recordId = row.record_id as string;
            const expectedOwner =
              finalOwnerByTarget.get(recordId) ??
              group.writtenOwnersByTarget.get(recordId) ??
              undefined;
            if ((row.linked_to ?? undefined) !== expectedOwner) {
              conflictingLinks.push({
                recordId,
                linkedTo: (row.linked_to as string | null) ?? null,
              });
            }
          }
          if (conflictingLinks.length > 0) break;
        }
      } catch (error) {
        return err(
          domainError.infrastructure({
            message: `Failed to validate final link ownership: ${describeError(error)}`,
            code: 'infrastructure.database.validate_link_exclusivity_failed',
          })
        );
      }
    }
    if (conflictingLinks.length > 0) {
      return err(
        domainError.validation({
          message:
            'Cannot link record(s): already linked to another record. In one-to-many relationships, each record can only belong to one parent.',
          code: 'validation.link.one_many_duplicate',
          localization: { i18nKey: sdkErrorI18nKeys.custom.linkOneManyDuplicate },
          details: {
            fieldId: group.fieldId.toString(),
            conflictingRecordIds: conflictingLinks.map(({ recordId }) => recordId),
            existingLinks: conflictingLinks,
          },
        })
      );
    }
    if (extraSeedMap && reparentedOwnerIds.size > 0) {
      const seedResult = mergeExtraSeedRecords(extraSeedMap, group.sourceTableId, [
        ...reparentedOwnerIds,
      ]);
      if (seedResult.isErr()) return err(seedResult.error);
    }
  }
  return ok(undefined);
};

/** Retain latest intent while authorizing only target rows changed by this transaction. */
const rememberLinkExclusivityIntents = async (
  db: Kysely<DynamicDB>,
  constraints: ReadonlyArray<LinkExclusivityConstraint>,
  sourceTableId: core.TableId,
  state: LinkExclusivityValidationState,
  writtenSourceIds: ReadonlySet<string>,
  capturedNoopReleaseTokens: ReadonlyArray<CapturedNoopReleaseToken>
): Promise<Result<void, DomainError>> => {
  if (constraints.length === 0) return ok(undefined);

  type QueryGroup = {
    type: 'two-way' | 'one-way';
    fkHostTableName: string;
    selfKeyName: string;
    foreignKeyName: string;
    foreignRecordIds: Set<string>;
    validation: LinkExclusivityValidationGroup;
  };
  const queryGroups = new Map<string, QueryGroup>();
  for (const constraint of constraints) {
    const type =
      constraint.usesJunctionTable || constraint.foreignKeyName !== RECORD_ID_COLUMN
        ? 'one-way'
        : 'two-way';
    if (type === 'one-way' && !writtenSourceIds.has(constraint.sourceRecordId)) continue;
    const groupKey = linkExclusivityGroupKey(
      type,
      constraint.fkHostTableName,
      constraint.selfKeyName,
      constraint.foreignKeyName,
      constraint.foreignTableId
    );
    let validation = state.get(groupKey);
    if (!validation) {
      validation = {
        groupKey,
        fieldId: constraint.fieldId,
        sourceTableId,
        foreignTableId: constraint.foreignTableId,
        fkHostTableName: constraint.fkHostTableName,
        selfKeyName: constraint.selfKeyName,
        ...(constraint.releaseOrderColumnName
          ? { releaseOrderColumnName: constraint.releaseOrderColumnName }
          : {}),
        ownsForeignRows: type === 'two-way',
        finalIntentBySource: new Map(),
        authoritativeDesiredBySource: new Map(),
        releaseAuthorizedSourceIds: new Set(),
        initialOwnersByTarget: new Map(),
        writtenOwnersByTarget: new Map(),
        inverseWrittenOwnersByTarget: new Map(),
        ownershipTransitionsByTarget: new Map(),
        writtenReleaseOwnersByTarget: new Map(),
        noopReleaseOwnersByTarget: new Map(),
        provenanceSequence: 0,
        pendingNoopReleaseTokens: [],
      };
      state.set(groupKey, validation);
    }

    const previousRevision =
      validation.finalIntentBySource.get(constraint.sourceRecordId)?.revision ?? 0;
    const intentSequence = ++validation.provenanceSequence;
    validation.finalIntentBySource.set(constraint.sourceRecordId, {
      desiredTargetRecordIds: constraint.desiredForeignRecordIds,
      revision: previousRevision + 1,
      sequence: intentSequence,
    });
    if (writtenSourceIds.has(constraint.sourceRecordId)) {
      validation.authoritativeDesiredBySource.set(
        constraint.sourceRecordId,
        constraint.desiredForeignRecordIds
      );
      if (type === 'one-way') validation.releaseAuthorizedSourceIds.add(constraint.sourceRecordId);
    } else {
      const previouslyWritten = validation.authoritativeDesiredBySource.get(
        constraint.sourceRecordId
      );
      if (previouslyWritten) {
        const previouslyWrittenIds = new Set(previouslyWritten);
        const retainedWritten = constraint.desiredForeignRecordIds.filter((id) =>
          previouslyWrittenIds.has(id)
        );
        if (retainedWritten.length > 0) {
          validation.authoritativeDesiredBySource.set(constraint.sourceRecordId, retainedWritten);
        } else {
          validation.authoritativeDesiredBySource.delete(constraint.sourceRecordId);
        }
      }
      validation.releaseAuthorizedSourceIds.delete(constraint.sourceRecordId);
    }

    let group = queryGroups.get(groupKey);
    if (!group) {
      group = {
        type,
        fkHostTableName: constraint.fkHostTableName,
        selfKeyName: constraint.selfKeyName,
        foreignKeyName: constraint.foreignKeyName,
        foreignRecordIds: new Set(),
        validation,
      };
      queryGroups.set(groupKey, group);
    }
    if (writtenSourceIds.has(constraint.sourceRecordId)) {
      for (const id of constraint.desiredForeignRecordIds) group.foreignRecordIds.add(id);
    }
  }

  for (const token of capturedNoopReleaseTokens) {
    const validation = state.get(token.groupKey);
    const intent = validation?.finalIntentBySource.get(token.sourceRecordId);
    if (
      !validation ||
      !validation.ownsForeignRows ||
      !intent ||
      writtenSourceIds.has(token.sourceRecordId) ||
      token.ownerRecordId !== token.sourceRecordId
    )
      continue;
    validation.pendingNoopReleaseTokens.push({
      ...token,
      intentRevision: intent.revision,
      intentSequence: intent.sequence,
    });
  }

  const orderedGroups = [...queryGroups].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  for (const [, group] of orderedGroups) {
    if (group.type === 'two-way') continue;
    const foreignRecordIds = [...group.foreignRecordIds].filter(
      (id) => !group.validation.initialOwnersByTarget.has(id)
    );
    if (foreignRecordIds.length === 0) continue;

    try {
      for (const id of foreignRecordIds) group.validation.initialOwnersByTarget.set(id, null);
      for (let offset = 0; offset < foreignRecordIds.length; offset += 500) {
        const ids = foreignRecordIds.slice(offset, offset + 500);
        const linkedRecords = await db
          .selectFrom(group.fkHostTableName)
          .select([
            sql.ref(group.foreignKeyName).as('record_id'),
            sql.ref(group.selfKeyName).as('linked_to'),
          ])
          .where(group.foreignKeyName, 'in', ids)
          .execute();

        for (const row of linkedRecords) {
          if (row.linked_to == null) continue;
          const targetId = row.record_id as string;
          const ownerId = row.linked_to as string;
          const owners = group.validation.initialOwnersByTarget.get(targetId);
          if (owners) owners.push(ownerId);
          else group.validation.initialOwnersByTarget.set(targetId, [ownerId]);
        }
      }
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to validate link exclusivity: ${describeError(error)}`,
          code: 'infrastructure.database.validate_link_exclusivity_failed',
        })
      );
    }
  }

  return ok(undefined);
};

/**
 * Lock all foreign-row FK targets before any insert ownership validation.
 * Fields sharing a physical host must share one database-ordered row lock query.
 * Junctions retain advisory locks; owning oneOne rows are locked by the INSERT.
 */
const acquireInsertExclusiveTargetLocks = async (
  db: Kysely<DynamicDB>,
  constraints: ReadonlyArray<InsertExclusivityConstraint>
): Promise<Result<void, DomainError>> => {
  const targetIdsByTable = new Map<string, Set<string>>();
  for (const constraint of constraints) {
    if (
      constraint.usesJunctionTable ||
      constraint.foreignKeyName !== RECORD_ID_COLUMN ||
      constraint.linkedForeignRecordIds.length === 0
    ) {
      continue;
    }
    let targetIds = targetIdsByTable.get(constraint.fkHostTableName);
    if (!targetIds) {
      targetIds = new Set<string>();
      targetIdsByTable.set(constraint.fkHostTableName, targetIds);
    }
    for (const targetId of constraint.linkedForeignRecordIds) {
      targetIds.add(targetId);
    }
  }

  const orderedTargets = [...targetIdsByTable].sort(
    ([left], [right]) => Number(left > right) - Number(left < right)
  );
  try {
    for (const [tableName, targetIds] of orderedTargets) {
      await db
        .selectFrom(tableName)
        .select(RECORD_ID_COLUMN)
        .where(RECORD_ID_COLUMN, 'in', [...targetIds])
        .orderBy(RECORD_ID_COLUMN)
        .forNoKeyUpdate()
        .execute();
    }
    return ok(undefined);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to lock insert link targets: ${describeError(error)}`,
        code: 'infrastructure.database.validate_insert_link_exclusivity_failed',
      })
    );
  }
};

/**
 * Validate link exclusivity constraints for insert operations.
 *
 * This function performs two checks:
 * 1. Cross-record duplicates: In the same batch, multiple records trying to link
 *    the same foreign record (for oneOne and oneMany relationships)
 * 2. Database conflicts: Foreign records already linked to other existing records
 * Physical target locks must already be held by acquireInsertExclusiveTargetLocks.
 *
 * @param db - Database connection
 * @param constraints - Array of insert exclusivity constraints to validate
 * @returns Ok if all constraints pass, Err with validation error if any fail
 */
const validateInsertExclusivityConstraints = async (
  context: core.IExecutionContext,
  db: Kysely<DynamicDB>,
  constraints: ReadonlyArray<InsertExclusivityConstraint>
): Promise<Result<void, DomainError>> => {
  if (constraints.length === 0) return ok(undefined);

  // Group constraints by field ID for cross-record duplicate checking
  const constraintsByField = new Map<string, InsertExclusivityConstraint[]>();
  for (const constraint of constraints) {
    const fieldIdStr = constraint.fieldId.toString();
    const existing = constraintsByField.get(fieldIdStr) ?? [];
    existing.push(constraint);
    constraintsByField.set(fieldIdStr, existing);
  }

  // Check 1: Cross-record duplicates within the same batch
  for (const [fieldIdStr, fieldConstraints] of constraintsByField) {
    const seenForeignRecordIds = new Map<string, string>(); // foreignRecordId -> sourceRecordId

    for (const constraint of fieldConstraints) {
      for (const foreignRecordId of constraint.linkedForeignRecordIds) {
        const existingSourceId = seenForeignRecordIds.get(foreignRecordId);
        if (existingSourceId && existingSourceId !== constraint.sourceRecordId) {
          const message =
            'Cannot link record(s): already linked by another record in the same batch. In one-to-many relationships, each record can only belong to one parent.';
          // Two different source records trying to link the same foreign record
          return err(
            domainError.validation({
              message,
              code: 'validation.link.batch_duplicate',
              localization: { i18nKey: sdkErrorI18nKeys.custom.linkBatchDuplicate },
              details: {
                fieldId: fieldIdStr,
                foreignRecordId,
                conflictingSourceRecords: [existingSourceId, constraint.sourceRecordId],
              },
            })
          );
        }
        seenForeignRecordIds.set(foreignRecordId, constraint.sourceRecordId);
      }
    }
  }

  // Check 2: Database conflicts - foreign records already linked to other existing records
  // Group constraints by fkHostTableName + query type to batch queries
  // Two types:
  // - Two-way links: FK is on foreign table, query by __id
  // - One-way links: FK is in junction table, query by foreignKeyName

  interface TwoWayQueryGroup {
    type: 'two-way';
    fkHostTableName: string;
    foreignTableId: string;
    selfKeyName: string;
    foreignRecordToSource: Map<string, string>;
    constraints: InsertExclusivityConstraint[];
  }

  interface OneWayQueryGroup {
    type: 'one-way';
    fkHostTableName: string; // junction table
    foreignTableId: string;
    selfKeyName: string; // points to source
    foreignKeyName: string; // points to foreign
    foreignRecordToSource: Map<string, string>;
    constraints: InsertExclusivityConstraint[];
  }

  type QueryGroup = TwoWayQueryGroup | OneWayQueryGroup;
  const queryGroups = new Map<string, QueryGroup>();

  for (const constraint of constraints) {
    // Skip if no foreign records to check
    if (constraint.linkedForeignRecordIds.length === 0) continue;

    if (constraint.usesJunctionTable || constraint.foreignKeyName !== RECORD_ID_COLUMN) {
      // Junction or owning oneOne: find the source by its foreign-key value.
      const groupKey = `junction::${constraint.fkHostTableName}::${constraint.foreignKeyName}::${constraint.foreignTableId.toString()}`;
      const existing = queryGroups.get(groupKey) as OneWayQueryGroup | undefined;
      if (existing) {
        for (const id of constraint.linkedForeignRecordIds) {
          existing.foreignRecordToSource.set(id, constraint.sourceRecordId);
        }
        existing.constraints.push(constraint);
      } else {
        queryGroups.set(groupKey, {
          type: 'one-way',
          fkHostTableName: constraint.fkHostTableName,
          foreignTableId: constraint.foreignTableId.toString(),
          selfKeyName: constraint.selfKeyName,
          foreignKeyName: constraint.foreignKeyName,
          foreignRecordToSource: new Map(
            constraint.linkedForeignRecordIds.map((id) => [id, constraint.sourceRecordId])
          ),
          constraints: [constraint],
        });
      }
    } else {
      // Two-way: query foreign table by __id
      const groupKey = `two-way::${constraint.fkHostTableName}::${constraint.selfKeyName}::${constraint.foreignTableId.toString()}`;
      const existing = queryGroups.get(groupKey) as TwoWayQueryGroup | undefined;
      if (existing) {
        for (const id of constraint.linkedForeignRecordIds) {
          existing.foreignRecordToSource.set(id, constraint.sourceRecordId);
        }
        existing.constraints.push(constraint);
      } else {
        queryGroups.set(groupKey, {
          type: 'two-way',
          fkHostTableName: constraint.fkHostTableName,
          foreignTableId: constraint.foreignTableId.toString(),
          selfKeyName: constraint.selfKeyName,
          foreignRecordToSource: new Map(
            constraint.linkedForeignRecordIds.map((id) => [id, constraint.sourceRecordId])
          ),
          constraints: [constraint],
        });
      }
    }
  }

  // Execute one query per group (instead of one per constraint)
  for (const [, group] of queryGroups) {
    if (group.foreignRecordToSource.size === 0) continue;

    try {
      if (group.type === 'two-way') {
        // Two-way: FK is on foreign table, query by __id
        const linkedRecords = await db
          .selectFrom(group.fkHostTableName)
          .select([
            sql.ref(RECORD_ID_COLUMN).as('record_id'),
            sql.ref(group.selfKeyName).as('linked_to'),
          ])
          .where(RECORD_ID_COLUMN, 'in', [...group.foreignRecordToSource.keys()])
          .execute();
        // A self-table restore may have already inserted the owning FK. Accept
        // only the exact owner requested for this child, not any batch source.
        const conflictingRecords = linkedRecords.filter((row) => {
          const expectedSource = group.foreignRecordToSource.get(row.record_id as string);
          return row.linked_to != null && row.linked_to !== expectedSource;
        });

        if (conflictingRecords.length > 0) {
          const conflictingIds = conflictingRecords.map((r) => r.record_id as string);
          const message =
            'Cannot link record(s): already linked to another record. In one-to-many relationships, each record can only belong to one parent.';
          const firstConstraint = group.constraints[0];
          return err(
            domainError.validation({
              message,
              code: 'validation.link.one_many_duplicate',
              localization: { i18nKey: sdkErrorI18nKeys.custom.linkOneManyDuplicate },
              details: {
                fieldId: firstConstraint.fieldId.toString(),
                conflictingRecordIds: conflictingIds,
                existingLinks: conflictingRecords.map((r) => ({
                  recordId: r.record_id,
                  linkedTo: r.linked_to,
                })),
              },
            })
          );
        }
      } else {
        // One-way: FK is in junction table, query by foreignKeyName
        // Check if any foreign records are already linked to OTHER sources
        const linkedRecords = await db
          .selectFrom(group.fkHostTableName)
          .select([
            sql.ref(group.foreignKeyName).as('foreign_id'),
            sql.ref(group.selfKeyName).as('linked_to'),
          ])
          .where(group.foreignKeyName, 'in', [...group.foreignRecordToSource.keys()])
          .execute();
        const conflictingRecords = linkedRecords.filter((row) => {
          const expectedSource = group.foreignRecordToSource.get(row.foreign_id as string);
          return row.linked_to !== expectedSource;
        });

        if (conflictingRecords.length > 0) {
          const conflictingIds = conflictingRecords.map((r) => r.foreign_id as string);
          const message =
            'Cannot link record(s): already linked to another record. In one-to-many relationships, each record can only belong to one parent.';
          const firstConstraint = group.constraints[0];
          return err(
            domainError.validation({
              message,
              code: 'validation.link.one_many_duplicate',
              localization: { i18nKey: sdkErrorI18nKeys.custom.linkOneManyDuplicate },
              details: {
                fieldId: firstConstraint.fieldId.toString(),
                conflictingRecordIds: conflictingIds,
                existingLinks: conflictingRecords.map((r) => ({
                  recordId: r.foreign_id,
                  linkedTo: r.linked_to,
                })),
              },
            })
          );
        }
      }
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to validate insert link exclusivity: ${describeError(error)}`,
          code: 'infrastructure.database.validate_insert_link_exclusivity_failed',
        })
      );
    }
  }

  return ok(undefined);
};

/**
 * Information about an incoming link field (a link field in another table that points to the target table).
 */
type IncomingLinkFieldInfo = {
  /** The table that has the link field */
  sourceTableId: string;
  /** Base that owns the incoming link field */
  sourceBaseId: string;
  /** The link field ID */
  fieldId: string;
  /** Display name of the incoming link field */
  fieldName: string;
  /** Display name of the table holding the incoming link field */
  sourceTableName: string;
  /** The relationship type */
  relationship: string;
  /** Whether it's a one-way link */
  isOneWay: boolean;
  /** Whether the incoming link field is required */
  notNull: boolean;
  /** JSONB display-value column on the host table */
  dbFieldName: string | null;
  /** Soft-deleted incoming field (physical FK may still exist) */
  fieldDeleted: boolean;
  /** Host table is in trash (physical FK may still exist) */
  tableDeleted: boolean;
  /** FK host table name (schema.table format) */
  fkHostTableName: string;
  /** The column name for the foreign key (points to deleted records) */
  foreignKeyName: string;
  /** The column name for the self key (source record) - for junction tables */
  selfKeyName: string | null;
  /** Order column name if exists */
  orderColumnName: string | null;
};

/**
 * Query for incoming link fields - link fields from OTHER tables OR self-referential links
 * that have foreignTableId = targetTableId.
 * These are links where the deleted records are the TARGET of the link.
 */
const loadIncomingLinkFields = async (
  db: Kysely<DynamicDB>,
  targetTableId: string
): Promise<Result<IncomingLinkFieldInfo[], DomainError>> => {
  try {
    // Query for link fields where foreignTableId = targetTableId
    // This includes:
    // 1. Links from OTHER tables pointing TO targetTableId
    // 2. Self-referential links (same table links to itself)
    const rows = await db
      .selectFrom('field')
      .innerJoin('table_meta', 'table_meta.id', 'field.table_id')
      .select([
        'field.id as field_id',
        'field.table_id as source_table_id',
        'field.name as field_name',
        'field.not_null as not_null',
        'field.db_field_name as db_field_name',
        'field.deleted_time as field_deleted_time',
        'table_meta.name as source_table_name',
        'table_meta.base_id as source_base_id',
        'table_meta.deleted_time as table_deleted_time',
        'field.options as options',
      ])
      .where(sql<SqlBool>`field.type = 'link'`)
      .where(sql<SqlBool>`(field.is_lookup IS NULL OR field.is_lookup = false)`)
      .where(sql`field.options::json->>'foreignTableId'`, '=', targetTableId)
      .execute();

    const result: IncomingLinkFieldInfo[] = [];

    for (const row of rows) {
      const options = typeof row.options === 'string' ? JSON.parse(row.options) : row.options;
      if (!options) continue;

      const relationship = options.relationship as string;
      const isOneWay = options.isOneWay === true;
      const fkHostTableName = options.fkHostTableName as string;
      const selfKeyName = options.selfKeyName as string | null;
      const foreignKeyName = options.foreignKeyName as string;

      // Determine what cleanup is needed based on relationship type
      // From the SOURCE table's perspective (the table that HAS the link field):
      // - manyOne: FK is on source table, keyed by TARGET record ID (foreignKeyName)
      // - oneOne: FK is on source table, keyed by TARGET record ID (foreignKeyName)
      // - manyMany: Junction table, need to delete rows where foreignKey matches deleted records
      // - oneMany (one-way): Junction table, need to delete rows where foreignKey matches deleted records
      // - oneMany (two-way): FK is on TARGET table - but that's handled by outgoing cleanup from target

      if (!fkHostTableName || !foreignKeyName) continue;

      result.push({
        sourceTableId: row.source_table_id as string,
        sourceBaseId: String(row.source_base_id ?? ''),
        fieldId: row.field_id as string,
        fieldName: String(row.field_name ?? ''),
        sourceTableName: String(row.source_table_name ?? ''),
        relationship,
        isOneWay,
        notNull: row.not_null === true,
        dbFieldName:
          typeof row.db_field_name === 'string' && row.db_field_name.length > 0
            ? row.db_field_name
            : null,
        fieldDeleted: row.field_deleted_time != null,
        tableDeleted: row.table_deleted_time != null,
        fkHostTableName,
        foreignKeyName,
        selfKeyName: selfKeyName ?? null,
        orderColumnName: options.orderColumnName ?? null,
      });
    }

    return ok(result);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to load incoming link fields: ${describeError(error)}`,
        code: 'infrastructure.database.load_incoming_link_fields_failed',
      })
    );
  }
};

const incomingLinkDeleteViolationError = (field: IncomingLinkFieldInfo): DomainError => {
  const details: Record<string, unknown> = {
    fieldId: field.fieldId,
    fieldName: field.fieldName,
    fieldType: 'link',
    tableId: field.sourceTableId,
    tableName: field.sourceTableName,
    baseId: field.sourceBaseId,
  };
  if (field.fieldDeleted) details.fieldDeleted = true;
  if (field.tableDeleted) details.tableDeleted = true;

  if (field.notNull) {
    return domainError.validation({
      code: 'validation.field.not_null',
      message: `Cannot delete record: required link field "${field.fieldName}" in table "${field.sourceTableName}" would become empty`,
      details,
      localization: {
        i18nKey: sdkErrorI18nKeys.custom.recordDeleteBlockedByRequiredLink,
        context: { tableName: field.sourceTableName, fieldName: field.fieldName },
      },
    });
  }

  return domainError.validation({
    code: 'validation.link.referenced',
    message: `Cannot delete record: link field "${field.fieldName}" in table "${field.sourceTableName}" still references it`,
    details,
    localization: {
      i18nKey: sdkErrorI18nKeys.custom.recordDeleteBlockedByLink,
      context: { tableName: field.sourceTableName, fieldName: field.fieldName },
    },
  });
};

const requiredIncomingLinkViolationError = (field: IncomingLinkFieldInfo): DomainError =>
  incomingLinkDeleteViolationError(field);

const loadIncomingLinkDeleteError = async (
  db: Kysely<DynamicDB>,
  error: unknown
): Promise<DomainError | undefined> => {
  const fieldId = extractForeignKeyFieldId(error);
  if (!fieldId) return undefined;

  try {
    const row = await db
      .selectFrom('field')
      .innerJoin('table_meta', 'table_meta.id', 'field.table_id')
      .select([
        'field.id as field_id',
        'field.table_id as source_table_id',
        'field.name as field_name',
        'field.not_null as not_null',
        'field.deleted_time as field_deleted_time',
        'table_meta.name as source_table_name',
        'table_meta.base_id as source_base_id',
        'table_meta.deleted_time as table_deleted_time',
      ])
      .where('field.id', '=', fieldId)
      .executeTakeFirst();
    if (!row) return undefined;

    return incomingLinkDeleteViolationError({
      sourceTableId: String(row.source_table_id ?? ''),
      sourceBaseId: String(row.source_base_id ?? ''),
      fieldId: String(row.field_id ?? fieldId),
      fieldName: String(row.field_name ?? ''),
      sourceTableName: String(row.source_table_name ?? ''),
      relationship: '',
      isOneWay: false,
      notNull: row.not_null === true,
      dbFieldName: null,
      fieldDeleted: row.field_deleted_time != null,
      tableDeleted: row.table_deleted_time != null,
      fkHostTableName: '',
      foreignKeyName: '',
      selfKeyName: null,
      orderColumnName: null,
    });
  } catch {
    return undefined;
  }
};

/**
 * Columns required by both seed reads and incoming cleanup. Junction and reverse
 * FK hosts do not carry the source table's JSONB display column.
 */
const incomingCleanupColumnNames = (field: IncomingLinkFieldInfo): string[] => {
  const columnNames: string[] = [];
  if (field.foreignKeyName && field.foreignKeyName !== '__id') {
    columnNames.push(field.foreignKeyName);
  }
  if (field.selfKeyName) {
    columnNames.push(field.selfKeyName);
  }
  const usesJunctionHost =
    field.relationship === 'manyMany' || (field.relationship === 'oneMany' && field.isOneWay);
  // JSONB display / order columns live on the source table. Junction hosts and
  // two-way oneMany hosts (FK on the deleted table) do not have them.
  if (!usesJunctionHost && (field.relationship === 'manyOne' || field.relationship === 'oneOne')) {
    if (field.orderColumnName) {
      columnNames.push(field.orderColumnName);
    }
    if (field.dbFieldName && field.dbFieldName !== field.foreignKeyName) {
      columnNames.push(field.dbFieldName);
    }
  }
  return columnNames;
};

/**
 * Only independent, active, optional incoming links can capture seeds while mutating.
 * Count all descriptors, including tombstones, so an earlier cleanup cannot erase
 * another descriptor's old links. Self/reverse links keep their pre-cleanup reads.
 */
const incomingReturningSeedFieldIds = (
  incomingFields: ReadonlyArray<IncomingLinkFieldInfo>,
  targetTableName: string,
  targetTableId: string
): ReadonlySet<string> => {
  const hostCounts = new Map<string, number>();
  for (const field of incomingFields) {
    const host = linkHostTableKey(field.fkHostTableName);
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
  }

  const targetHost = linkHostTableKey(targetTableName);
  const fieldIds = new Set<string>();
  for (const field of incomingFields) {
    const host = linkHostTableKey(field.fkHostTableName);
    if (
      field.fieldDeleted ||
      field.tableDeleted ||
      field.notNull ||
      field.sourceTableId === targetTableId ||
      host === targetHost ||
      hostCounts.get(host) !== 1
    ) {
      continue;
    }
    const usesJunctionHost =
      field.relationship === 'manyMany' || (field.relationship === 'oneMany' && field.isOneWay);
    if (
      (usesJunctionHost && field.selfKeyName) ||
      ((field.relationship === 'manyOne' || field.relationship === 'oneOne') &&
        field.foreignKeyName !== '__id')
    ) {
      fieldIds.add(field.fieldId);
    }
  }
  return fieldIds;
};

/**
 * Clean incoming FK/junction storage, capturing independent seeds with RETURNING.
 * Catalog checks skip missing storage; SAVEPOINT still handles concurrent DDL.
 * Required links retain their surviving-host blocking checks.
 */
const executeIncomingLinkCleanup = async (
  db: Kysely<DynamicDB>,
  recordIds: ReadonlyArray<string>,
  incomingFields: ReadonlyArray<IncomingLinkFieldInfo>,
  targetTableName: string,
  targetTableId: string,
  extraSeedMap: Map<string, { tableId: core.TableId; recordIds: Map<string, core.RecordId> }>,
  catalog: LinkHostCatalog,
  returningFieldIds: ReadonlySet<string>
): Promise<Result<void, DomainError>> => {
  if (recordIds.length === 0 || incomingFields.length === 0) return ok(undefined);

  try {
    for (const [index, field] of incomingFields.entries()) {
      const physicalExists = catalogHasTableAndColumns(
        catalog,
        field.fkHostTableName,
        incomingCleanupColumnNames(field)
      );
      if (!physicalExists) {
        // Skip SQL when the host table/columns are already gone. Deleted fields
        // still clean up when the physical FK may still exist.
        continue;
      }

      const savepointIdentifier = await beginIncomingLinkSavepoint(db, field.fieldId, index);
      let restoreSavepoint = false;
      try {
        const {
          sourceTableId,
          relationship,
          isOneWay,
          fkHostTableName,
          foreignKeyName,
          selfKeyName,
          orderColumnName,
          dbFieldName,
        } = field;

        const isSelfReferential = sourceTableId === targetTableId;
        const fkOnDeletedTable = fkHostTableName === targetTableName;
        let seedRows: ReadonlyArray<{ source_id: unknown }> | undefined;

        if (relationship === 'manyMany' || (relationship === 'oneMany' && isOneWay)) {
          // Junction table: a required host row must not lose its last link. A host is
          // blocked when it links to a deleted record and keeps no surviving link;
          // hosts that are themselves being deleted (self-referential) don't count.
          if (field.notNull && selfKeyName) {
            let blockingQuery = db
              .selectFrom(`${fkHostTableName} as d`)
              .select(sql.ref(`d.${selfKeyName}`).as('host_id'))
              .where(`d.${foreignKeyName}`, 'in', recordIds as string[])
              .where((eb) =>
                eb.not(
                  eb.exists(
                    eb
                      .selectFrom(`${fkHostTableName} as s`)
                      .select(sql`1`.as('one'))
                      .whereRef(`s.${selfKeyName}`, '=', `d.${selfKeyName}`)
                      .where(`s.${foreignKeyName}`, 'not in', recordIds as string[])
                  )
                )
              )
              .limit(1);
            if (isSelfReferential) {
              blockingQuery = blockingQuery.where(
                `d.${selfKeyName}`,
                'not in',
                recordIds as string[]
              );
            }
            const blockingRow = await blockingQuery.executeTakeFirst();
            if (blockingRow) return err(requiredIncomingLinkViolationError(field));
          }
          if (returningFieldIds.has(field.fieldId) && selfKeyName) {
            // One source may lose several edges; deduplicate inside Postgres.
            seedRows = await db
              .with('deleted_link_rows', (qb) =>
                qb
                  .deleteFrom(fkHostTableName)
                  .where(foreignKeyName, 'in', recordIds as string[])
                  .returning(sql.ref(selfKeyName).as('source_id'))
              )
              .selectFrom('deleted_link_rows')
              .select('source_id')
              .distinct()
              .execute();
          } else {
            await db
              .deleteFrom(fkHostTableName)
              .where(foreignKeyName, 'in', recordIds as string[])
              .execute();
          }
        } else if (
          (relationship === 'manyOne' || relationship === 'oneOne') &&
          foreignKeyName !== '__id' &&
          (!fkOnDeletedTable || isSelfReferential)
        ) {
          // FK on source table. A required link blocks the delete when a surviving
          // source row still points at a deleted record; rows that are deleted in the
          // same batch (self-referential) are not blocking.
          if (field.notNull) {
            let blockingQuery = db
              .selectFrom(fkHostTableName)
              .select('__id')
              .where(foreignKeyName, 'in', recordIds as string[])
              .limit(1);
            if (isSelfReferential) {
              blockingQuery = blockingQuery.where('__id', 'not in', recordIds as string[]);
            }
            const blockingRow = await blockingQuery.executeTakeFirst();
            if (blockingRow) return err(requiredIncomingLinkViolationError(field));
            // No surviving row points at the deleted records, so the nullify below
            // could only touch rows that are being deleted anyway.
            continue;
          }
          // Nullify FK where it points to deleted records
          const updateValues: Record<string, null> = {
            [foreignKeyName]: null,
          };
          if (orderColumnName) {
            updateValues[orderColumnName] = null;
          }
          if (dbFieldName && dbFieldName !== foreignKeyName) {
            updateValues[dbFieldName] = null;
          }
          const updateQuery = db
            .updateTable(fkHostTableName)
            .set(updateValues)
            .where(foreignKeyName, 'in', recordIds as string[]);
          if (returningFieldIds.has(field.fieldId)) {
            seedRows = await updateQuery.returning(sql.ref('__id').as('source_id')).execute();
          } else {
            await updateQuery.execute();
          }
        } else if (fkOnDeletedTable && selfKeyName) {
          // FK column lives on the table being deleted (two-way oneMany, or the
          // non-hosting side of a two-way oneOne): the FK rows disappear with the
          // delete, so there is nothing to clean up, but a required link on the other
          // side must not lose its last link. A surviving host is emptied when a
          // deleted row points at it and no surviving row still does.
          if (field.notNull) {
            let blockingQuery = db
              .selectFrom(`${fkHostTableName} as d`)
              .select(sql.ref(`d.${selfKeyName}`).as('host_id'))
              .where('d.__id', 'in', recordIds as string[])
              .where(`d.${selfKeyName}`, 'is not', null)
              .where((eb) =>
                eb.not(
                  eb.exists(
                    eb
                      .selectFrom(`${fkHostTableName} as s`)
                      .select(sql`1`.as('one'))
                      .whereRef(`s.${selfKeyName}`, '=', `d.${selfKeyName}`)
                      .where('s.__id', 'not in', recordIds as string[])
                  )
                )
              )
              .limit(1);
            if (isSelfReferential) {
              blockingQuery = blockingQuery.where(
                `d.${selfKeyName}`,
                'not in',
                recordIds as string[]
              );
            }
            const blockingRow = await blockingQuery.executeTakeFirst();
            if (blockingRow) return err(requiredIncomingLinkViolationError(field));
          }
        }
        // Remaining cleanup for two-way oneMany FKs is handled by the outgoing link
        // cleanup via FieldDeleteValueVisitor
        if (seedRows?.length) {
          const sourceRecordIds = seedRows
            .map((row) => row.source_id)
            .filter((id): id is string => typeof id === 'string');
          const tableIdResult = core.TableId.create(sourceTableId);
          if (tableIdResult.isErr()) return err(tableIdResult.error);
          const mergeResult = mergeExtraSeedRecords(
            extraSeedMap,
            tableIdResult.value,
            sourceRecordIds
          );
          if (mergeResult.isErr()) return err(mergeResult.error);
        }
      } catch (error) {
        restoreSavepoint = true;
        await rollbackIncomingLinkSavepoint(db, savepointIdentifier);
        if (isMissingRelationError(error)) continue;
        throw error;
      } finally {
        if (!restoreSavepoint) {
          await releaseIncomingLinkSavepoint(db, savepointIdentifier);
        }
      }
    }

    return ok(undefined);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to execute incoming link cleanup: ${describeError(error)}`,
        code: 'infrastructure.database.incoming_link_cleanup_failed',
      })
    );
  }
};

/**
 * Collect extra seed records from incoming link fields.
 * These are records in OTHER tables that link TO the deleted records.
 */
const collectIncomingLinkExtraSeedRecords = async (
  db: Kysely<DynamicDB>,
  recordIds: ReadonlyArray<string>,
  incomingFields: ReadonlyArray<IncomingLinkFieldInfo>,
  extraSeedMap: Map<string, { tableId: core.TableId; recordIds: Map<string, core.RecordId> }>,
  catalog: LinkHostCatalog,
  returningFieldIds: ReadonlySet<string>
): Promise<Result<void, DomainError>> => {
  if (recordIds.length === 0 || incomingFields.length === 0) return ok(undefined);

  try {
    for (const [index, field] of incomingFields.entries()) {
      if (field.fieldDeleted || field.tableDeleted || returningFieldIds.has(field.fieldId))
        continue;
      const physicalExists = catalogHasTableAndColumns(
        catalog,
        field.fkHostTableName,
        incomingCleanupColumnNames(field)
      );
      if (!physicalExists) continue;
      const savepointIdentifier = await beginIncomingLinkSavepoint(db, field.fieldId, index);
      let restoreSavepoint = false;
      try {
        const {
          sourceTableId,
          relationship,
          isOneWay,
          fkHostTableName,
          foreignKeyName,
          selfKeyName,
        } = field;

        let sourceKeyName: string | null = null;
        let targetKeyName = foreignKeyName;
        if (relationship === 'manyMany' || (relationship === 'oneMany' && isOneWay)) {
          sourceKeyName = selfKeyName;
        } else if (relationship === 'manyOne' || relationship === 'oneOne') {
          sourceKeyName = '__id';
        } else if (relationship === 'oneMany' && !isOneWay) {
          // Reverse FK: the deleted rows hold the source table's IDs in selfKeyName.
          sourceKeyName = selfKeyName;
          targetKeyName = '__id';
        }
        if (!sourceKeyName) continue;

        const rows = await db
          .selectFrom(fkHostTableName)
          .select(sql.ref(sourceKeyName).as('source_id'))
          .distinct()
          .where(targetKeyName, 'in', recordIds as string[])
          .where(sourceKeyName, 'is not', null)
          .execute();
        const sourceRecordIds = rows
          .map((row) => row.source_id)
          .filter((id): id is string => typeof id === 'string');

        // Merge into extraSeedMap
        if (sourceRecordIds.length > 0) {
          const tableIdResult = core.TableId.create(sourceTableId);
          if (tableIdResult.isErr()) return err(tableIdResult.error);
          const mergeResult = mergeExtraSeedRecords(
            extraSeedMap,
            tableIdResult.value,
            sourceRecordIds
          );
          if (mergeResult.isErr()) return err(mergeResult.error);
        }
      } catch (error) {
        restoreSavepoint = true;
        await rollbackIncomingLinkSavepoint(db, savepointIdentifier);
        if (isMissingRelationError(error)) continue;
        throw error;
      } finally {
        if (!restoreSavepoint) {
          await releaseIncomingLinkSavepoint(db, savepointIdentifier);
        }
      }
    }

    return ok(undefined);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to collect incoming link extra seed records: ${describeError(error)}`,
        code: 'infrastructure.database.collect_incoming_link_seeds_failed',
      })
    );
  }
};
