import { tableI18nKeys } from '@teable/i18n-keys';
import * as core from '@teable/v2-core';
import {
  domainError,
  type ILogger,
  v2CoreTokens,
  type DomainError,
  type IHasher,
  type DeleteManyResult,
  generateUuid,
  type RecordMutationResult,
  type BatchRecordMutationResult,
  type InsertOptions,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Expression, type Kysely, type SqlBool, type Transaction } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { resolvePostgresDbOrTx } from '../../shared/db';
import { describeError, wrapDatabaseError } from '../../shared/errors';
import {
  splitSchemaQualifiedTableName,
  toQualifiedIdentifierLiteral,
} from '../../shared/sqlIdentifiers';
import type { UndoLogRow } from '../../shared/undoCapture';
import type {
  ComputedBeforeImageRecord,
  ComputedFieldUpdater,
  ComputedUpdatePlanner,
  ComputedUpdateResult,
  IUpdateStrategy,
  UpdateImpactHint,
  IComputedUpdateOutbox,
} from '../computed';
import { buildSeedTaskInput } from '../computed';
import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
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
} from '../query-builder/update/BatchUpdateSqlBuilder';
import { RecordUpdateBuilder } from '../query-builder/update/RecordUpdateBuilder';
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
        !Object.prototype.hasOwnProperty.call(setClauses, dbFieldNameValue)
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

const parseTrashedRecordIds = (snapshot: string): string[] => {
  try {
    const parsed = JSON.parse(snapshot);
    return Array.isArray(parsed)
      ? parsed.filter((recordId): recordId is string => typeof recordId === 'string')
      : [];
  } catch {
    return [];
  }
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
    const snapshot = asString(item.snapshot);
    if (!id || !snapshot) {
      return [];
    }

    const recordIds = parseTrashedRecordIds(snapshot);
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

/**
 * Internal insert options that extend core InsertOptions with PostgreSQL-specific flags.
 */
interface InternalInsertManyOptions extends core.InsertOptions {
  /**
   * When true, computed field updates are skipped entirely.
   * Used by insertManyStream with deferComputedUpdates to batch all updates at the end.
   */
  skipComputedUpdates?: boolean;
  /**
   * When true, insert snapshot capture is skipped.
   * Restore/import flows do not need undo snapshots and may run before capture
   * infrastructure is installed in ephemeral databases.
   */
  skipSnapshotCapture?: boolean;
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

async function checkOrderColumnExists(
  db: Kysely<DynamicDB>,
  tableName: string,
  orderColumnName: string
): Promise<boolean> {
  const { schemaName, plainTableName } = splitSchemaQualifiedTableName(tableName);
  const result = await sql<{ column_name: string }>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = ${schemaName ?? 'public'}
    AND table_name = ${plainTableName}
    AND column_name = ${orderColumnName}
  `.execute(db);

  return result.rows.length > 0;
}

async function ensureViewOrderColumnsExist(
  db: Kysely<DynamicDB>,
  tableName: string,
  viewIds: ReadonlyArray<string>
): Promise<void> {
  const { plainTableName } = splitSchemaQualifiedTableName(tableName);
  const uniqueViewIds = [...new Set(viewIds.filter(Boolean))];

  for (const viewId of uniqueViewIds) {
    const orderColumnName = `__row_${viewId}`;
    const exists = await checkOrderColumnExists(db, tableName, orderColumnName);

    if (!exists) {
      await sql`
        ALTER TABLE ${sql.table(tableName)}
        ADD COLUMN ${sql.id(orderColumnName)} double precision
      `.execute(db);

      await sql`
        UPDATE ${sql.table(tableName)}
        SET ${sql.id(orderColumnName)} = __auto_number
        WHERE ${sql.id(orderColumnName)} IS NULL
      `.execute(db);

      const indexName = `idx_${plainTableName}_${orderColumnName}`;
      await sql`
        CREATE INDEX ${sql.id(indexName)}
        ON ${sql.table(tableName)} (${sql.id(orderColumnName)})
      `.execute(db);
    }
  }
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
      if (!Object.prototype.hasOwnProperty.call(row, dbFieldNameText)) {
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
  for (const { fieldId, alias } of columns) {
    const fieldIdStr = fieldId.toString();
    if (allowedFieldIds && !allowedFieldIds.has(fieldIdStr)) {
      continue;
    }
    changedFields.set(fieldIdStr, row[alias]);
  }
  return changedFields.size > 0 ? changedFields : undefined;
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

const loadBeforeImageForRecord = async (
  db: Kysely<DynamicDB>,
  tableName: string,
  recordId: core.RecordId,
  trackedFields: ReadonlyArray<BulkUpdateTrackedField>
): Promise<Result<ComputedBeforeImageRecord | undefined, DomainError>> => {
  if (trackedFields.length === 0) {
    return ok(undefined);
  }

  try {
    const row = (await db
      .selectFrom(tableName)
      .select([
        sql.ref(RECORD_ID_COLUMN).as('record_id'),
        ...trackedFields.map(({ dbFieldName, oldValueAlias }) =>
          sql.ref(dbFieldName).as(oldValueAlias)
        ),
      ])
      .where(RECORD_ID_COLUMN, '=', recordId.toString())
      .executeTakeFirst()) as BeforeImageTrackedRow | undefined;

    if (!row || row.record_id !== recordId.toString()) {
      return ok(undefined);
    }

    return ok(
      buildBeforeImageFromTrackedValues(
        recordId,
        trackedFields,
        Object.fromEntries(
          trackedFields.map(({ fieldId, oldValueAlias }) => [
            fieldId.toString(),
            row[oldValueAlias],
          ])
        )
      )
    );
  } catch (error) {
    return err(
      wrapDatabaseError(error, 'query', { tableName, recordId: recordId.toString() }, undefined)
    );
  }
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
    private readonly metaDb: Kysely<V1TeableDatabase> = db
  ) {}

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
    userId: string | undefined,
    fallback: ActorIdentity
  ): Promise<ActorIdentity> {
    if (!userId) {
      return fallback;
    }

    return this.resolveActorIdentity(db, userId, fallback);
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
        const createdByIdentity = await this.resolveRestoreActorIdentity(
          actorLookupDb,
          restoreValues?.createdBy,
          restoreValues?.createdBy === actorId ? actorIdentity : {}
        );
        const lastModifiedByIdentity = await this.resolveRestoreActorIdentity(
          actorLookupDb,
          restoreValues?.lastModifiedBy,
          restoreValues?.lastModifiedBy === restoreValues?.createdBy
            ? createdByIdentity
            : restoreValues?.lastModifiedBy === actorId
              ? actorIdentity
              : {}
        );

        // Get view order info for all views in the table
        const views = table.views();
        const viewOrderInfo = await getViewOrderInfo(actorLookupDb, tableName, views);

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
            ...(restoreValues?.lastModifiedTime
              ? { lastModifiedTime: restoreValues.lastModifiedTime }
              : {}),
            ...(restoreValues?.lastModifiedBy
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
        if (restoreValues?.orders) {
          await ensureViewOrderColumnsExist(db, tableName, Object.keys(restoreValues.orders));
        }
        let viewOrderValues = restoreValues?.orders
          ? buildSnapshotViewOrderValues(restoreValues.orders)
          : {};
        if (Object.keys(viewOrderValues).length === 0) {
          viewOrderValues = buildViewOrderValues(viewOrderInfo, 0);
        }

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

        // Validate link exclusivity constraints for oneOne/oneMany relationships
        yield* await validateInsertExclusivityConstraints(context, db, exclusivityConstraints);

        this.logger.debug(`insert:table=${tableName}`, { values: valuesWithViewOrder });

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

          // Acquire advisory locks for linked records to prevent deadlocks
          const baseId = table.baseId().toString();
          await acquireLinkedRecordLocks(db, baseId, linkedRecordLocks);

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
          return err(
            wrapDatabaseError(error, 'insert', { tableName, fields: table.getFields() }, context.$t)
          );
        }
      }.bind(this)
    );
  }

  /**
   * Default batch size for insertMany to stay under PostgreSQL's ~65535 parameter limit.
   * With ~10 columns per record (user fields + system columns), 500 records = ~5000 params.
   */
  private static readonly INSERT_BATCH_SIZE = 500;

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
        const shouldCaptureSnapshot = !options?.skipSnapshotCapture && !options?.restoreRecordsById;
        const tableWasEmpty = !(await tableHasExistingRows(db, tableName));
        // Resolve actor identity outside transaction-scoped connection to avoid
        // marking the current transaction as aborted when optional lookup fails.
        const actorLookupDb = this.metaDb as unknown as Kysely<DynamicDB>;
        const actorIdentity = await this.resolveActorIdentity(actorLookupDb, actorId, actorContext);
        const restoreIdentityCache = new Map<string, ActorIdentity>();
        const resolveRestoreIdentity = async (
          userId: string | undefined,
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

        // Get view order info for all views in the table
        const views = table.views();
        const viewOrderInfo = await getViewOrderInfo(actorLookupDb, tableName, views);
        const restoreViewIds = options?.restoreRecordsById
          ? [...options.restoreRecordsById.values()].flatMap((value) =>
              Object.keys(value.orders ?? {})
            )
          : [];
        if (restoreViewIds.length > 0) {
          await ensureViewOrderColumnsExist(db, tableName, restoreViewIds);
        }

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
            restoreValues?.lastModifiedBy,
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
              ...(restoreValues?.lastModifiedTime
                ? { lastModifiedTime: restoreValues.lastModifiedTime }
                : {}),
              ...(restoreValues?.lastModifiedBy
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
          let viewOrderValues = restoreValues?.orders
            ? buildSnapshotViewOrderValues(restoreValues.orders)
            : {};
          if (Object.keys(viewOrderValues).length === 0) {
            viewOrderValues = buildViewOrderValues(viewOrderInfo, recordIndex);
          }

          // If ordering is specified, override the target view's order value
          if (calculatedOrderValues && orderColumnName) {
            viewOrderValues = {
              ...viewOrderValues,
              [orderColumnName]: calculatedOrderValues[recordIndex],
            };
          }

          const valuesWithViewOrder = {
            ...insertDataResult.value.values,
            ...(restoreValues?.extraColumnValues ?? {}),
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

        // Validate link exclusivity constraints:
        // 1. Check for cross-record duplicates within the same batch
        // 2. Check against existing database records
        yield* await validateInsertExclusivityConstraints(context, db, allExclusivityConstraints);

        this.logger.debug(`insertMany:table=${tableName}`, { count: records.length });

        let snapshotCaptureSession: IPostgresRecordMutationSnapshotCaptureSession | undefined;
        try {
          if (shouldCaptureSnapshot) {
            snapshotCaptureSession = yield* await this.recordMutationSnapshotCapture.begin(
              toRecordMutationSnapshotTraceContext(context),
              db,
              tableName
            );
          }

          // Execute batch inserts to stay under PG parameter limit
          const batchSize = PostgresTableRecordRepository.INSERT_BATCH_SIZE;
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
          const changedFieldColumns = yield* toChangedFieldColumns(table, uniqueChangedFieldIds);
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

          // Acquire advisory locks for linked records to prevent deadlocks
          const baseId = table.baseId().toString();
          await acquireLinkedRecordLocks(db, baseId, allLinkedRecordLocks);

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
              allExtraSeedRecordGroups
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
          return err(
            wrapDatabaseError(error, 'insert', { tableName, fields: table.getFields() }, context.$t)
          );
        }
      }.bind(this)
    );
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

    // When deferring computed updates, collect all records for final batch update
    const allInsertedRecords: core.TableRecord[] = [];

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
        skipComputedUpdates: skipComputed || deferComputed,
        skipSnapshotCapture: restoreRecordsById != null,
        ...(restoreRecordsById ? { restoreRecordsById } : {}),
      });
      if (result.isErr()) {
        return result;
      }

      // Track records if deferring computed updates
      if (deferComputed) {
        allInsertedRecords.push(...records);
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

    try {
      if (Symbol.asyncIterator in batches) {
        for await (const batch of batches as AsyncIterable<core.InsertManyStreamBatchInput>) {
          const result = await processBatch(batch);
          if (result.isErr()) {
            return err(result.error);
          }
        }
      } else {
        for (const batch of batches as Iterable<core.InsertManyStreamBatchInput>) {
          const result = await processBatch(batch);
          if (result.isErr()) {
            return err(result.error);
          }
        }
      }
    } catch (error) {
      return err(
        core.isDomainError(error)
          ? error
          : core.domainError.unexpected({
              code: 'record.insert_many_stream.iteration_failed',
              message: `Unexpected insert stream error: ${describeError(error)}`,
            })
      );
    }

    if (deferComputed && allInsertedRecords.length > 0) {
      const computedResult = enqueueDeferredComputedUpdates
        ? await this.enqueueDeferredComputedUpdateMany(context, table, allInsertedRecords)
        : this.scheduleDeferredComputedUpdateMany(context, table, allInsertedRecords);
      if (computedResult.isErr()) {
        return err(computedResult.error);
      }
    }

    return ok({ totalInserted });
  }

  private scheduleDeferredComputedUpdateMany(
    context: core.IExecutionContext,
    table: core.Table,
    records: ReadonlyArray<core.TableRecord>
  ): Result<void, DomainError> {
    const computeContext: core.IExecutionContext = { ...context };
    delete computeContext.transaction;
    const run = () => {
      void this.runComputedUpdateMany(computeContext, table, records, 'insert', []).then(
        (result) => {
          if (result.isErr()) {
            this.logger.warn('computed:deferred:failed', {
              error: result.error.message,
              tableId: table.id().toString(),
              recordCount: records.length,
            });
          }
        }
      );
    };

    if (context.transaction?.afterCommit) {
      context.transaction.afterCommit(run);
    } else {
      run();
    }

    return ok(undefined);
  }

  private async enqueueDeferredComputedUpdateMany(
    context: core.IExecutionContext,
    table: core.Table,
    records: ReadonlyArray<core.TableRecord>
  ): Promise<Result<void, DomainError>> {
    if (records.length === 0) return ok(undefined);
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

    const changedFieldIds = this.expandComputedSeedFieldIds(table, [...fieldIds.values()]);
    if (changedFieldIds.length === 0) {
      return ok(undefined);
    }

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
      orchestration: resolveComputedRealtimeOrchestration(context, recordIds.length),
    });

    const enqueueResult = await this.computedUpdateOutbox.enqueueSeedTask(seedTask, context);
    if (enqueueResult.isErr()) {
      return err(enqueueResult.error);
    }

    const dispatchContext: core.IExecutionContext = { ...context };
    delete dispatchContext.transaction;
    const dispatch = () => this.computedUpdateStrategy.scheduleDispatch(dispatchContext);
    if (context.transaction?.afterCommit) {
      context.transaction.afterCommit(dispatch);
    } else {
      dispatch();
    }

    return ok(undefined);
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
        const recordIdStr = recordId.toString();
        const actorId = context.actorId.toString();
        const actorContext = context as core.IExecutionContext & {
          actorName?: string;
          actorEmail?: string;
        };
        const now = new Date().toISOString();

        // Use transaction-aware database connection
        const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;

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
              actorName: actorContext.actorName,
              actorEmail: actorContext.actorEmail,
              ...(options?.fillLinkTitles ? { fillLinkTitles: true } : {}),
              ...(options?.fillLinkTitleForeignTables
                ? { fillLinkTitleForeignTables: options.fillLinkTitleForeignTables }
                : {}),
            },
          });
        const { impactHint, extraSeedRecords, exclusivityConstraints } = impact;
        const changedFieldColumns = yield* toChangedFieldColumns(table, changedFieldIds);
        const distinctUserFieldWhere = yield* buildDistinctUserFieldWhere(table, setClauses);
        const normalizedImpact = this.normalizeImpactHint(impactHint);
        const expandedChangedFieldIds = this.expandComputedSeedFieldIds(
          table,
          impactHint.valueFieldIds.concat(impactHint.linkFieldIds)
        );
        const beforeImageCapturePlan = yield* await this.resolveBeforeImageCapturePlan(
          context,
          table,
          expandedChangedFieldIds,
          'update',
          normalizedImpact
        );
        let beforeImageRecord: ComputedBeforeImageRecord | undefined;
        if (beforeImageCapturePlan.needsBeforeImage) {
          beforeImageRecord =
            beforeImageCapturePlan.trackedFields.length === 0
              ? buildEmptyBeforeImageRecord(recordId)
              : yield* await loadBeforeImageForRecord(
                  db,
                  tableName,
                  recordId,
                  beforeImageCapturePlan.trackedFields
                );
        }

        // Validate link exclusivity constraints before persisting
        // This ensures that in oneMany/oneOne relationships, a foreign record
        // cannot be linked to multiple source records
        yield* await validateLinkExclusivityConstraints(context, db, exclusivityConstraints);

        let snapshotCaptureSession: IPostgresRecordMutationSnapshotCaptureSession | undefined;
        try {
          snapshotCaptureSession = yield* await this.recordMutationSnapshotCapture.begin(
            toRecordMutationSnapshotTraceContext(context),
            db,
            tableName
          );

          let updateQuery = db
            .updateTable(tableName)
            .set(setClauses)
            .where(RECORD_ID_COLUMN, '=', recordIdStr);
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

          // Acquire advisory locks for linked records to prevent deadlocks
          const baseId = table.baseId().toString();
          await acquireLinkedRecordLocks(db, baseId, linkedRecordLocks);

          // Execute additional statements (junction table updates, FK updates)
          for (const stmt of additionalStatements) {
            await db.executeQuery(stmt.compiled);
          }

          const mutationRows = yield* await snapshotCaptureSession.finish();
          const updateSnapshot = yield* buildRecordUpdateSnapshotFromUndoRows(
            table,
            mutationRows,
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

          // Run computed field updates
          const computedResult = yield* await this.runComputedUpdateById(
            context,
            table,
            recordId,
            'update',
            impactHint,
            extraSeedRecords,
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
            wrapDatabaseError(
              error,
              'update',
              {
                tableName,
                recordId: recordIdStr,
                fields: table.getFields(),
              },
              context.$t
            )
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

        const mutateVisitor = CellValueMutateVisitor.create(db, table, tableName, {
          recordId: '__bulk_update__',
          actorId,
          now,
          actorName: actorContext.actorName,
          actorEmail: actorContext.actorEmail,
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
          'update'
        );
        const changedTrackedFields = yield* toBulkUpdateTrackedFields(table, changedFieldIds);
        const trackedFields = mergeTrackedFields(
          changedTrackedFields,
          beforeImageCapturePlan.trackedFields
        );
        const distinctUserFieldWhere = yield* buildDistinctUserFieldWhere(table, setClauses);

        try {
          const matchedSelects = [
            sql.ref(RECORD_ID_COLUMN).as('matched_id'),
            sql.ref(VERSION_COLUMN).as('old_version'),
            ...trackedFields.map(({ dbFieldName, oldValueAlias }) =>
              sql.ref(dbFieldName).as(oldValueAlias)
            ),
          ];

          const returningSelects = [
            sql.ref(RECORD_ID_COLUMN).as('record_id'),
            sql.ref(VERSION_COLUMN).as('new_version'),
            sql.ref('matched.old_version').as('old_version'),
            ...trackedFields.map(({ oldValueAlias }) =>
              sql.ref(`matched.${oldValueAlias}`).as(oldValueAlias)
            ),
          ];

          let updateQuery = db
            .with('matched', (qb) =>
              qb.selectFrom(tableName).select(matchedSelects).where(whereExpression)
            )
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
            const impact = {
              valueFieldIds: changedFieldIds,
              linkFieldIds: [],
            };
            const computedResult = deferComputed
              ? enqueueDeferredComputedUpdates
                ? await this.runComputedUpdateManyByIds(
                    context,
                    table,
                    updatedRecordIds,
                    impact,
                    [],
                    beforeImageRecords,
                    {
                      forceOutbox: true,
                      scheduleDispatchAfterCommit: true,
                    }
                  )
                : this.scheduleDeferredComputedUpdateManyByIds(
                    context,
                    table,
                    updatedRecordIds,
                    impact,
                    [],
                    beforeImageRecords
                  )
              : await this.runComputedUpdateManyByIds(
                  context,
                  table,
                  updatedRecordIds,
                  impact,
                  [],
                  beforeImageRecords
                );
            if (computedResult.isErr()) {
              return err(computedResult.error);
            }
          }

          if (updatedRecordIds.length > 0) {
            await this.touchTableMeta(context, table.id().toString(), actorId);
          }

          return ok({
            totalUpdated: updatedRecordIds.length,
            updatedRecordIds,
            updatedRecords,
          });
        } catch (error) {
          return err(
            wrapDatabaseError(error, 'update', { tableName, fields: table.getFields() }, context.$t)
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
        const allValueFieldIds = new Map<string, core.FieldId>();
        const allLinkFieldIds = new Map<string, core.FieldId>();
        const extraSeedMap = new Map<
          string,
          { tableId: core.TableId; recordIds: Map<string, core.RecordId> }
        >();
        const skipComputed = options?.skipComputedUpdates ?? false;
        const deferComputed = !skipComputed && (options?.deferComputedUpdates ?? false);
        const enqueueDeferredComputedUpdates =
          deferComputed && (options?.enqueueDeferredComputedUpdates ?? false);
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

          // Use BatchRecordUpdateBuilder to build batch update data
          const batchUpdateBuilder = new BatchRecordUpdateBuilder(db);
          const batchDataResult = await batchUpdateBuilder.buildBatchUpdateData({
            table: batchTable,
            tableName,
            updates,
            context: {
              actorId: context.actorId.toString(),
              now,
              actorName: actorContext.actorName,
              actorEmail: actorContext.actorEmail,
              ...(options?.fillLinkTitles ? { fillLinkTitles: true } : {}),
              ...(options?.fillLinkTitleForeignTables
                ? { fillLinkTitleForeignTables: options.fillLinkTitleForeignTables }
                : {}),
            },
          });
          if (batchDataResult.isErr()) {
            return err(batchDataResult.error);
          }

          const {
            columnUpdateData,
            additionalStatements,
            linkedRecordLocks,
            impact,
            systemColumns,
          } = batchDataResult.value;
          batchSpan?.setAttributes({
            'record.update.batchColumnCount': columnUpdateData.size,
            'record.update.batchAdditionalStatementCount': additionalStatements.length,
            'record.update.batchLinkedLockCount': linkedRecordLocks.length,
            'record.update.batchValueFieldCount': impact.valueFieldIds.length,
            'record.update.batchLinkFieldCount': impact.impactHint.linkFieldIds.length,
          });

          try {
            // Generate and execute batch UPDATE SQL
            const returnedOldFields = collectBatchUpdateReturnedOldFields(
              batchTable,
              columnUpdateData
            );
            const updateSqlResult = buildBatchUpdateSql({
              tableName,
              columnUpdateData,
              systemColumns,
              table: batchTable,
              db,
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

            const queryResult = await db.executeQuery(updateSqlResult.value);
            const batchUpdatedRecords: Array<
              NonNullable<core.UpdateManyStreamResult['updatedRecords']>[number]
            > = [];
            for (const row of queryResult.rows as ReadonlyArray<Record<string, unknown>>) {
              const rawId = row.record_id;
              if (typeof rawId !== 'string') {
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
              });
            }

            if (batchUpdatedRecords.length > 0) {
              // Acquire advisory locks for linked records (deduplicated, single query)
              const baseId = batchTable.baseId().toString();
              await acquireLinkedRecordLocks(db, baseId, linkedRecordLocks);

              // Execute additional statements (junction tables, FK updates)
              for (const stmt of additionalStatements) {
                await db.executeQuery(stmt.compiled);
              }

              for (const update of batchUpdatedRecords) {
                affectedRecordIds.set(update.recordId.toString(), update.recordId);
              }
              // Preserve the same computed impact semantics as single-record updates.
              for (const fieldId of impact.valueFieldIds) {
                allValueFieldIds.set(fieldId.toString(), fieldId);
              }
              for (const fieldId of impact.impactHint.linkFieldIds) {
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
              wrapDatabaseError(
                error,
                'update',
                { tableName, fields: table.getFields() },
                context.$t
              )
            );
          } finally {
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

        // Trigger computed field updates once after all batches
        if (totalUpdated > 0) {
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
                    [],
                    {
                      forceOutbox: true,
                      scheduleDispatchAfterCommit: true,
                    }
                  )
                : this.scheduleDeferredComputedUpdateManyByIds(
                    context,
                    table,
                    affectedRecords,
                    impact,
                    extraSeedRecords
                  )
              : await this.runComputedUpdateManyByIds(
                  context,
                  table,
                  affectedRecords,
                  impact,
                  extraSeedRecords
                );
            if (computedResult.isErr()) {
              return err(computedResult.error);
            }
          }
          await this.touchTableMeta(context, table.id().toString(), actorId);
        }

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
    } = {}
  ): Promise<Result<void, DomainError>> {
    const changedFieldIds = impact ? [...impact.valueFieldIds, ...impact.linkFieldIds] : [];
    const expandedChangedFieldIds = this.expandComputedSeedFieldIds(table, changedFieldIds);
    if (recordIds.length === 0 || expandedChangedFieldIds.length === 0) {
      return ok(undefined);
    }
    const normalizedImpact = this.normalizeImpactHint(impact);

    if (this.computedUpdateStrategy.mode === 'sync' && !options.forceOutbox) {
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
      if (plan.steps.length === 0) {
        return ok(undefined);
      }

      const executeResult = await this.computedUpdateStrategy.execute(
        this.computedFieldUpdater,
        plan,
        context
      );
      if (executeResult.isErr()) {
        this.logger.warn('computed:seed:execute_batch_failed', {
          error: executeResult.error.message,
          tableId: table.id().toString(),
          recordCount: recordIds.length,
        });
        return err(executeResult.error);
      }

      await this.publishComputedUpdateEvents(
        context,
        table.baseId(),
        executeResult.value,
        resolveComputedRealtimeOrchestration(context, recordIds.length)
      );

      return ok(undefined);
    }

    // For hybrid/async mode, skip planStage to minimize transaction lock hold time.
    // The worker will plan when it processes the seed task asynchronously.
    // This matches the pattern used by runComputedUpdate (single-record path).
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
      orchestration: resolveComputedRealtimeOrchestration(context, recordIds.length),
    });

    const enqueueResult = await this.computedUpdateOutbox.enqueueSeedTask(seedTask, context);
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
    beforeImageRecords: ReadonlyArray<ComputedBeforeImageRecord> = []
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
        beforeImageRecords
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
          return ok({});
        }

        // Collect link field operations using visitor pattern
        const deleteVisitor = FieldDeleteValueVisitor.create({
          recordIds: recordIdStrings,
        });

        const linkFieldOps: Array<{
          field: core.LinkField;
          operation: OutgoingLinkDeleteOp;
        }> = [];

        for (const field of table.getFields()) {
          const visitResult = field.accept(deleteVisitor);
          if (visitResult.isErr()) return err(visitResult.error);

          const { operation } = visitResult.value;
          if (operation && field.type().equals(core.FieldType.link())) {
            linkFieldOps.push({
              field: field as core.LinkField,
              operation,
            });
          }
        }

        // Collect extraSeedRecords for all link fields using batch query (O(linkFields) queries instead of O(records × linkFields))
        for (const { field: linkField } of linkFieldOps) {
          const linkRecordsMap = yield* await loadExistingLinkRecordIdsBatch(
            db,
            tableName,
            recordIdStrings,
            linkField,
            this.logger
          );

          // Flatten all linked record IDs for this field
          const allLinkedIds: string[] = [];
          for (const linkedIds of linkRecordsMap.values()) {
            for (const id of linkedIds) {
              if (!allLinkedIds.includes(id)) {
                allLinkedIds.push(id);
              }
            }
          }

          const mergeResult = mergeExtraSeedRecords(
            extraSeedMap,
            linkField.foreignTableId(),
            allLinkedIds
          );
          if (mergeResult.isErr()) return err(mergeResult.error);
        }

        // Load incoming link fields (link fields from OTHER tables that point to THIS table)
        const metaDb = this.resolveMetaDb(context);
        const incomingFieldsResult = await loadIncomingLinkFields(
          metaDb,
          table.baseId().toString(),
          table.id().toString()
        );
        if (incomingFieldsResult.isErr()) return err(incomingFieldsResult.error);
        const incomingFields = incomingFieldsResult.value;

        // Collect extra seed records from incoming links (BEFORE cleanup)
        const incomingSeedsResult = await collectIncomingLinkExtraSeedRecords(
          db,
          recordIdStrings,
          incomingFields,
          extraSeedMap
        );
        if (incomingSeedsResult.isErr()) return err(incomingSeedsResult.error);

        // Execute incoming link cleanup (clean FK/junction pointing TO deleted records)
        const incomingCleanupResult = await executeIncomingLinkCleanup(
          db,
          recordIdStrings,
          incomingFields,
          tableName, // Pass target table name to skip symmetric link cleanup
          table.id().toString() // Pass target table ID to detect self-referential links
        );
        if (incomingCleanupResult.isErr()) return err(incomingCleanupResult.error);

        // Execute all outgoing delete operations
        for (const { field, operation } of linkFieldOps) {
          const outgoingDeleteResult = await executeOutgoingLinkDeleteOp(
            db,
            recordIdStrings,
            operation,
            field,
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
          await db.deleteFrom(tableName).where(whereExpression).execute();
          const mutationRows = yield* await snapshotCaptureSession.finish();
          const deletedSnapshots = yield* buildStoredRecordSnapshotsFromDeletedUndoRows(
            table,
            mutationRows,
            recordIdStrings
          );
          if (deletedSnapshots.length !== recordIds.length) {
            this.logger.warn('record:snapshot:missing', {
              operation: 'delete',
              tableId: table.id().toString(),
              recordIds: recordIdStrings,
              expectedCount: recordIds.length,
              actualCount: deletedSnapshots.length,
            });
            return err(
              buildMissingSnapshotError(
                'delete',
                table.id().toString(),
                recordIds.length,
                deletedSnapshots.length
              )
            );
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
          return err(
            wrapDatabaseError(
              error,
              'delete',
              {
                tableName,
                count: recordIds.length,
                fields: table.getFields(),
              },
              context.$t
            )
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
    const changedFieldIds = record
      .fields()
      .entries()
      .map((entry) => entry.fieldId);
    const expandedChangedFieldIds = this.expandComputedSeedFieldIds(table, changedFieldIds);

    // If no changed fields, nothing to compute
    if (expandedChangedFieldIds.length === 0) {
      return ok(undefined);
    }

    const normalizedImpact = this.normalizeImpactHint(impact);

    const shouldExecuteInline =
      this.computedUpdateStrategy.mode === 'sync' ||
      (this.computedUpdateStrategy.mode === 'hybrid' && changeType === 'insert');

    // For sync mode and hybrid inserts, plan and execute directly before the undo snapshot is read.
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

      const planResult = await this.computedUpdatePlanner.planStage(planInput, context);
      if (planResult.isErr()) {
        this.logger.warn('computed:seed:plan_failed', {
          error: planResult.error.message,
          tableId: table.id().toString(),
          recordId: record.id().toString(),
        });
        return err(planResult.error);
      }

      const plan = planResult.value;
      if (plan.steps.length > 0) {
        const executeResult = await this.computedUpdateStrategy.execute(
          this.computedFieldUpdater,
          plan,
          context
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
    const enqueueResult = await this.computedUpdateOutbox.enqueueSeedTask(seedTask, context);
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
    beforeImageRecords: ReadonlyArray<ComputedBeforeImageRecord> = []
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

    const changedFieldIds = this.expandComputedSeedFieldIds(table, [...fieldIds.values()]);

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

      const planResult = await this.computedUpdatePlanner.planStage(planInput, context);
      if (planResult.isErr()) {
        this.logger.warn('computed:seed:plan_many_failed', {
          error: planResult.error.message,
          tableId: table.id().toString(),
          recordCount: recordIds.length,
        });
        return err(planResult.error);
      }

      const plan = planResult.value;
      if (plan.steps.length > 0) {
        const executeResult = await this.computedUpdateStrategy.execute(
          this.computedFieldUpdater,
          plan,
          context
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
            resolveComputedRealtimeOrchestration(context, recordIds.length)
          );
        }
        return ok(executeResult.value);
      }

      return ok(undefined);
    }

    // For hybrid update/delete and async mode, use the outbox pattern.
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
      orchestration: resolveComputedRealtimeOrchestration(context, recordIds.length),
    });

    // Enqueue seed task - plan computation and execution happens asynchronously in the worker
    const enqueueResult = await this.computedUpdateOutbox.enqueueSeedTask(seedTask, context);
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
      (this.computedUpdateStrategy.mode === 'hybrid' && changeType === 'insert');

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
      if (plan.steps.length > 0) {
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
    const enqueueResult = await this.computedUpdateOutbox.enqueueSeedTask(seedTask, context);
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
    orchestration?: core.IExecutionContext['batchMutation']
  ): Promise<void> {
    if (!result?.changesByStep.length) {
      return;
    }

    const events = buildComputedUpdateEvents(result.changesByStep, baseId, orchestration);
    if (!events.length) {
      return;
    }

    const publishResult = await this.eventBus.publishMany(context, events);
    if (publishResult.isErr()) {
      this.logger.warn('computed:events_publish_failed', {
        error: publishResult.error.message,
        eventCount: events.length,
      });
    }
  }

  private expandComputedSeedFieldIds(
    table: core.Table,
    changedFieldIds: ReadonlyArray<core.FieldId>
  ): core.FieldId[] {
    if (changedFieldIds.length === 0) {
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
      if (plan.steps.length > 0) {
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
    const enqueueResult = await this.computedUpdateOutbox.enqueueSeedTask(seedTask, context);
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
  orchestration?: core.IExecutionContext['batchMutation']
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

    const updates = recordChanges.map((change) => ({
      recordId: change.recordId,
      oldVersion: change.oldVersion,
      newVersion: change.oldVersion + 1,
      changes: change.changes.map((fieldChange) => ({
        fieldId: fieldChange.fieldId,
        oldValue: null as unknown,
        newValue: fieldChange.newValue,
      })),
    }));

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
  recordCount: number
): core.IExecutionContext['batchMutation'] =>
  core.buildOperationBatchMutation(context, recordCount);

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

const resolveFkHostTableName = (field: core.LinkField): Result<string, DomainError> => {
  return field
    .fkHostTableName()
    .split({ defaultSchema: 'public' })
    .map((split) => (split.schema ? `${split.schema}.${split.tableName}` : split.tableName));
};

type ExternalLinkHostPlan = {
  hostTableName: string;
  operationType: OutgoingLinkDeleteOp['type'];
};

const resolveExternalLinkHostPlan = (
  field: core.LinkField
): Result<ExternalLinkHostPlan | undefined, DomainError> => {
  const relationship = field.relationship().toString();
  if (relationship === 'manyMany' || (relationship === 'oneMany' && field.isOneWay())) {
    return resolveFkHostTableName(field).map((hostTableName) => ({
      hostTableName,
      operationType: 'junction-delete' as const,
    }));
  }

  if (relationship === 'oneMany') {
    return resolveFkHostTableName(field).map((hostTableName) => ({
      hostTableName,
      operationType: 'fk-nullify' as const,
    }));
  }

  return ok(undefined);
};

const checkTableExists = async (db: Kysely<DynamicDB>, tableName: string): Promise<boolean> => {
  const { schemaName, plainTableName } = splitSchemaQualifiedTableName(tableName);
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = ${schemaName ?? 'public'}
      AND table_name = ${plainTableName}
    ) AS exists
  `.execute(db);

  return result.rows[0]?.exists === true;
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

  if (candidate.code === '42P01' || candidate.meta?.code === '42P01') {
    return true;
  }

  const message = candidate.meta?.message ?? candidate.message;
  if (
    typeof message === 'string' &&
    message.includes('relation') &&
    message.includes('does not exist')
  ) {
    return true;
  }

  return isMissingRelationError(candidate.cause) || isMissingRelationError(candidate.originalError);
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

const preflightExternalLinkHostTable = async (
  db: Kysely<DynamicDB>,
  field: core.LinkField,
  logger: ILogger,
  phase: 'load-existing' | 'cleanup-outgoing',
  recordCount: number
): Promise<Result<boolean, DomainError>> => {
  const hostPlanResult = resolveExternalLinkHostPlan(field);
  if (hostPlanResult.isErr()) {
    return err(hostPlanResult.error);
  }

  const hostPlan = hostPlanResult.value;
  if (!hostPlan) {
    return ok(true);
  }

  try {
    const exists = await checkTableExists(db, hostPlan.hostTableName);
    if (!exists) {
      warnMissingLinkHostTable(logger, {
        phase,
        field,
        hostTableName: hostPlan.hostTableName,
        operationType: hostPlan.operationType,
        recordCount,
        error: 'preflight: link host table missing',
      });
    }
    return ok(exists);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to check link host table existence: ${describeError(error)}`,
      })
    );
  }
};

/**
 * Execute an outgoing link delete operation.
 * Takes the operation descriptor from FieldDeleteValueVisitor and executes it.
 */
const executeOutgoingLinkDeleteOp = async (
  db: Kysely<DynamicDB>,
  recordIds: ReadonlyArray<string>,
  operation: OutgoingLinkDeleteOp,
  field: core.LinkField,
  logger: ILogger
): Promise<Result<void, DomainError>> => {
  if (recordIds.length === 0) return ok(undefined);

  const hostCheckResult = await preflightExternalLinkHostTable(
    db,
    field,
    logger,
    'cleanup-outgoing',
    recordIds.length
  );
  if (hostCheckResult.isErr()) {
    return err(hostCheckResult.error);
  }
  if (!hostCheckResult.value) {
    return ok(undefined);
  }

  try {
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
  }
};

/**
 * Batch load existing link record IDs for multiple records.
 * Returns a Map<recordId, linkedRecordIds[]> for a single link field.
 * This reduces O(records × linkFields) queries to O(linkFields) queries.
 */
const loadExistingLinkRecordIdsBatch = async (
  db: Kysely<DynamicDB>,
  tableName: string,
  recordIds: ReadonlyArray<string>,
  field: core.LinkField,
  logger: ILogger
): Promise<Result<Map<string, string[]>, DomainError>> => {
  const result = new Map<string, string[]>();
  if (recordIds.length === 0) return ok(result);

  // Initialize all records with empty arrays
  for (const recordId of recordIds) {
    result.set(recordId, []);
  }

  const relationship = field.relationship().toString();
  const hostCheckResult = await preflightExternalLinkHostTable(
    db,
    field,
    logger,
    'load-existing',
    recordIds.length
  );
  if (hostCheckResult.isErr()) {
    return err(hostCheckResult.error);
  }
  if (!hostCheckResult.value) {
    return ok(result);
  }

  try {
    if (relationship === 'manyMany' || (relationship === 'oneMany' && field.isOneWay())) {
      // Junction table: SELECT selfKey, foreignKey FROM junction WHERE selfKey IN (...)
      const junctionTableResult = resolveFkHostTableName(field);
      if (junctionTableResult.isErr()) return err(junctionTableResult.error);
      const selfKeyResult = field.selfKeyNameString();
      if (selfKeyResult.isErr()) return err(selfKeyResult.error);
      const foreignKeyResult = field.foreignKeyNameString();
      if (foreignKeyResult.isErr()) return err(foreignKeyResult.error);

      const rows = await db
        .selectFrom(junctionTableResult.value)
        .select([
          sql.ref(selfKeyResult.value).as('self_key'),
          sql.ref(foreignKeyResult.value).as('foreign_key'),
        ])
        .where(selfKeyResult.value, 'in', recordIds as string[])
        .execute();

      for (const row of rows) {
        const selfKey = row.self_key;
        const foreignKey = row.foreign_key;
        if (typeof selfKey === 'string' && typeof foreignKey === 'string') {
          const existing = result.get(selfKey) ?? [];
          existing.push(foreignKey);
          result.set(selfKey, existing);
        }
      }
      return ok(result);
    }

    if (relationship === 'manyOne' || relationship === 'oneOne') {
      // FK on current table: SELECT __id, fk FROM table WHERE __id IN (...)
      const foreignKeyResult = field.foreignKeyNameString();
      if (foreignKeyResult.isErr()) return err(foreignKeyResult.error);

      const rows = await db
        .selectFrom(tableName)
        .select([
          sql.ref(RECORD_ID_COLUMN).as('record_id'),
          sql.ref(foreignKeyResult.value).as('foreign_key'),
        ])
        .where(RECORD_ID_COLUMN, 'in', recordIds as string[])
        .execute();

      for (const row of rows) {
        const recordId = row.record_id;
        const foreignKey = row.foreign_key;
        if (typeof recordId === 'string' && typeof foreignKey === 'string') {
          result.set(recordId, [foreignKey]);
        }
      }
      return ok(result);
    }

    if (relationship === 'oneMany') {
      // FK on foreign table: SELECT selfKey, __id FROM foreignTable WHERE selfKey IN (...)
      const foreignTableResult = resolveFkHostTableName(field);
      if (foreignTableResult.isErr()) return err(foreignTableResult.error);
      const selfKeyResult = field.selfKeyNameString();
      if (selfKeyResult.isErr()) return err(selfKeyResult.error);

      const rows = await db
        .selectFrom(foreignTableResult.value)
        .select([
          sql.ref(selfKeyResult.value).as('self_key'),
          sql.ref(RECORD_ID_COLUMN).as('foreign_key'),
        ])
        .where(selfKeyResult.value, 'in', recordIds as string[])
        .execute();

      for (const row of rows) {
        const selfKey = row.self_key;
        const foreignKey = row.foreign_key;
        if (typeof selfKey === 'string' && typeof foreignKey === 'string') {
          const existing = result.get(selfKey) ?? [];
          existing.push(foreignKey);
          result.set(selfKey, existing);
        }
      }
      return ok(result);
    }

    return ok(result);
  } catch (error) {
    if (isMissingRelationError(error)) {
      const hostTableResult = resolveFkHostTableName(field);
      warnMissingLinkHostTable(logger, {
        phase: 'load-existing',
        field,
        hostTableName: hostTableResult.isOk() ? hostTableResult.value : 'unknown',
        operationType:
          relationship === 'manyMany' || (relationship === 'oneMany' && field.isOneWay())
            ? 'junction-delete'
            : 'fk-nullify',
        recordCount: recordIds.length,
        error,
      });
      return ok(result);
    }
    return err(
      domainError.infrastructure({
        message: `Failed to batch load existing link records: ${describeError(error)}`,
      })
    );
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

/**
 * Build an advisory lock key for a linked record to prevent deadlocks.
 * The key format ensures consistent ordering across concurrent transactions.
 */
const buildLinkedRecordLockKey = (
  baseId: string,
  foreignTableId: string,
  foreignRecordId: string
): string => `v2:link:${baseId}:${foreignTableId}:${foreignRecordId}`;

/**
 * Acquire advisory locks for linked records to prevent deadlocks.
 * Locks are acquired in sorted key order to ensure consistent lock ordering.
 * Uses a single batch query to minimize database round-trips.
 */
const acquireLinkedRecordLocks = async (
  db: Kysely<DynamicDB>,
  baseId: string,
  linkedRecordLocks: ReadonlyArray<LinkedRecordLockInfo>
): Promise<void> => {
  if (linkedRecordLocks.length === 0) return;

  // Deduplicate and build lock keys
  const lockKeysSet = new Set<string>();
  for (const lock of linkedRecordLocks) {
    const key = buildLinkedRecordLockKey(baseId, lock.foreignTableId, lock.foreignRecordId);
    lockKeysSet.add(key);
  }

  // Sort keys to ensure consistent lock ordering across transactions
  const lockKeys = [...lockKeysSet].sort();

  if (lockKeys.length === 0) return;

  // Acquire all locks in a single batch query
  // Format array as PostgreSQL array literal: ARRAY['key1', 'key2', ...]
  const arrayLiteral = `ARRAY[${lockKeys.map((k) => `'${k.replace(/'/g, "''")}'`).join(',')}]`;
  await db.executeQuery(
    sql`SELECT pg_advisory_xact_lock(('x' || substr(md5(k), 1, 16))::bit(64)::bigint)
        FROM unnest(${sql.raw(arrayLiteral)}::text[]) AS k
        ORDER BY k`.compile(db)
  );
};

/**
 * Validate link exclusivity constraints before persisting.
 *
 * For oneOne and oneMany relationships, each foreign record can only be linked
 * to ONE source record. This function checks if any of the foreign records
 * being newly linked are already linked to a different source record.
 *
 * @param context - Execution context for i18n translation
 * @param db - Database connection
 * @param constraints - Array of exclusivity constraints to validate
 * @returns Ok if all constraints pass, Err with validation error if any fail
 */
const i18nOrFallback = (
  t: core.IExecutionContext['$t'],
  key: Parameters<NonNullable<core.IExecutionContext['$t']>>[0],
  fallback: string,
  options?: Record<string, unknown>
): string => {
  if (!t) return fallback;
  try {
    return t(key, options);
  } catch {
    return fallback;
  }
};

const validateLinkExclusivityConstraints = async (
  context: core.IExecutionContext,
  db: Kysely<DynamicDB>,
  constraints: ReadonlyArray<LinkExclusivityConstraint>
): Promise<Result<void, DomainError>> => {
  if (constraints.length === 0) return ok(undefined);

  // Group constraints by fkHostTableName + query type to batch queries
  // Two types:
  // - Two-way links: FK is on foreign table, query by __id
  // - One-way links: FK is in junction table, query by foreignKeyName

  interface TwoWayQueryGroup {
    type: 'two-way';
    fkHostTableName: string;
    foreignTableId: string;
    selfKeyName: string;
    // Map from foreignRecordId to sourceRecordId (to check each foreign record against its source)
    foreignRecordToSource: Map<string, string>;
    constraints: LinkExclusivityConstraint[];
  }

  interface OneWayQueryGroup {
    type: 'one-way';
    fkHostTableName: string; // junction table
    foreignTableId: string;
    selfKeyName: string; // points to source
    foreignKeyName: string; // points to foreign
    // Map from foreignRecordId to sourceRecordId
    foreignRecordToSource: Map<string, string>;
    constraints: LinkExclusivityConstraint[];
  }

  type QueryGroup = TwoWayQueryGroup | OneWayQueryGroup;
  const queryGroups = new Map<string, QueryGroup>();

  for (const constraint of constraints) {
    // Skip if no foreign records to check
    if (constraint.addedForeignRecordIds.length === 0) continue;

    if (constraint.usesJunctionTable) {
      // Junction table: query by foreignKeyName (oneMany isOneWay)
      const groupKey = `junction::${constraint.fkHostTableName}::${constraint.foreignKeyName}::${constraint.foreignTableId.toString()}`;
      const existing = queryGroups.get(groupKey) as OneWayQueryGroup | undefined;
      if (existing) {
        for (const id of constraint.addedForeignRecordIds) {
          existing.foreignRecordToSource.set(id, constraint.sourceRecordId);
        }
        existing.constraints.push(constraint);
      } else {
        const foreignRecordToSource = new Map<string, string>();
        for (const id of constraint.addedForeignRecordIds) {
          foreignRecordToSource.set(id, constraint.sourceRecordId);
        }
        queryGroups.set(groupKey, {
          type: 'one-way',
          fkHostTableName: constraint.fkHostTableName,
          foreignTableId: constraint.foreignTableId.toString(),
          selfKeyName: constraint.selfKeyName,
          foreignKeyName: constraint.foreignKeyName,
          foreignRecordToSource,
          constraints: [constraint],
        });
      }
    } else {
      // Two-way: query foreign table by __id
      const groupKey = `two-way::${constraint.fkHostTableName}::${constraint.selfKeyName}::${constraint.foreignTableId.toString()}`;
      const existing = queryGroups.get(groupKey) as TwoWayQueryGroup | undefined;
      if (existing) {
        for (const id of constraint.addedForeignRecordIds) {
          existing.foreignRecordToSource.set(id, constraint.sourceRecordId);
        }
        existing.constraints.push(constraint);
      } else {
        const foreignRecordToSource = new Map<string, string>();
        for (const id of constraint.addedForeignRecordIds) {
          foreignRecordToSource.set(id, constraint.sourceRecordId);
        }
        queryGroups.set(groupKey, {
          type: 'two-way',
          fkHostTableName: constraint.fkHostTableName,
          foreignTableId: constraint.foreignTableId.toString(),
          selfKeyName: constraint.selfKeyName,
          foreignRecordToSource,
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
        const foreignRecordIds = [...group.foreignRecordToSource.keys()];
        const linkedRecords = await db
          .selectFrom(group.fkHostTableName)
          .select([
            sql.ref(RECORD_ID_COLUMN).as('record_id'),
            sql.ref(group.selfKeyName).as('linked_to'),
          ])
          .where(RECORD_ID_COLUMN, 'in', foreignRecordIds)
          .where(group.selfKeyName, 'is not', null)
          .execute();

        // Check each linked record against its expected source
        const conflictingRecords = linkedRecords.filter((r) => {
          const expectedSource = group.foreignRecordToSource.get(r.record_id as string);
          return r.linked_to !== expectedSource;
        });

        if (conflictingRecords.length > 0) {
          const firstConstraint = group.constraints[0];
          const conflictingIds = conflictingRecords.map((r) => r.record_id as string);
          const message = i18nOrFallback(
            context.$t,
            tableI18nKeys.validation.link.one_many_duplicate,
            'Cannot link record(s): already linked to another record. In one-to-many relationships, each record can only belong to one parent.',
            undefined
          );
          return err(
            domainError.validation({
              message,
              code: 'validation.link.one_many_duplicate',
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
        const foreignRecordIds = [...group.foreignRecordToSource.keys()];
        const linkedRecords = await db
          .selectFrom(group.fkHostTableName)
          .select([
            sql.ref(group.foreignKeyName).as('foreign_id'),
            sql.ref(group.selfKeyName).as('linked_to'),
          ])
          .where(group.foreignKeyName, 'in', foreignRecordIds)
          .execute();

        // Check each linked record against its expected source
        const conflictingRecords = linkedRecords.filter((r) => {
          const expectedSource = group.foreignRecordToSource.get(r.foreign_id as string);
          return r.linked_to !== expectedSource;
        });

        if (conflictingRecords.length > 0) {
          const firstConstraint = group.constraints[0];
          const conflictingIds = conflictingRecords.map((r) => r.foreign_id as string);
          const message = i18nOrFallback(
            context.$t,
            tableI18nKeys.validation.link.one_many_duplicate,
            'Cannot link record(s): already linked to another record. In one-to-many relationships, each record can only belong to one parent.',
            undefined
          );
          return err(
            domainError.validation({
              message,
              code: 'validation.link.one_many_duplicate',
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
          message: `Failed to validate link exclusivity: ${describeError(error)}`,
          code: 'infrastructure.database.validate_link_exclusivity_failed',
        })
      );
    }
  }

  return ok(undefined);
};

/**
 * Validate link exclusivity constraints for insert operations.
 *
 * This function performs two checks:
 * 1. Cross-record duplicates: In the same batch, multiple records trying to link
 *    the same foreign record (for oneOne and oneMany relationships)
 * 2. Database conflicts: Foreign records already linked to other existing records
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
          const message = i18nOrFallback(
            context.$t,
            tableI18nKeys.validation.link.batch_duplicate,
            'Cannot link record(s): already linked by another record in the same batch. In one-to-many relationships, each record can only belong to one parent.',
            undefined
          );
          // Two different source records trying to link the same foreign record
          return err(
            domainError.validation({
              message,
              code: 'validation.link.batch_duplicate',
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
    foreignRecordIds: Set<string>;
    constraints: InsertExclusivityConstraint[];
  }

  interface OneWayQueryGroup {
    type: 'one-way';
    fkHostTableName: string; // junction table
    foreignTableId: string;
    selfKeyName: string; // points to source
    foreignKeyName: string; // points to foreign
    foreignRecordIds: Set<string>;
    sourceRecordIds: Set<string>; // to exclude self-links
    constraints: InsertExclusivityConstraint[];
  }

  type QueryGroup = TwoWayQueryGroup | OneWayQueryGroup;
  const queryGroups = new Map<string, QueryGroup>();

  for (const constraint of constraints) {
    // Skip if no foreign records to check
    if (constraint.linkedForeignRecordIds.length === 0) continue;

    if (constraint.usesJunctionTable) {
      // Junction table: query by foreignKeyName (oneMany isOneWay, manyMany)
      const groupKey = `junction::${constraint.fkHostTableName}::${constraint.foreignKeyName}::${constraint.foreignTableId.toString()}`;
      const existing = queryGroups.get(groupKey) as OneWayQueryGroup | undefined;
      if (existing) {
        for (const id of constraint.linkedForeignRecordIds) {
          existing.foreignRecordIds.add(id);
        }
        existing.sourceRecordIds.add(constraint.sourceRecordId);
        existing.constraints.push(constraint);
      } else {
        queryGroups.set(groupKey, {
          type: 'one-way',
          fkHostTableName: constraint.fkHostTableName,
          foreignTableId: constraint.foreignTableId.toString(),
          selfKeyName: constraint.selfKeyName,
          foreignKeyName: constraint.foreignKeyName,
          foreignRecordIds: new Set(constraint.linkedForeignRecordIds),
          sourceRecordIds: new Set([constraint.sourceRecordId]),
          constraints: [constraint],
        });
      }
    } else {
      // Two-way: query foreign table by __id
      const groupKey = `two-way::${constraint.fkHostTableName}::${constraint.selfKeyName}::${constraint.foreignTableId.toString()}`;
      const existing = queryGroups.get(groupKey) as TwoWayQueryGroup | undefined;
      if (existing) {
        for (const id of constraint.linkedForeignRecordIds) {
          existing.foreignRecordIds.add(id);
        }
        existing.constraints.push(constraint);
      } else {
        queryGroups.set(groupKey, {
          type: 'two-way',
          fkHostTableName: constraint.fkHostTableName,
          foreignTableId: constraint.foreignTableId.toString(),
          selfKeyName: constraint.selfKeyName,
          foreignRecordIds: new Set(constraint.linkedForeignRecordIds),
          constraints: [constraint],
        });
      }
    }
  }

  // Execute one query per group (instead of one per constraint)
  for (const [, group] of queryGroups) {
    if (group.foreignRecordIds.size === 0) continue;

    try {
      if (group.type === 'two-way') {
        // Two-way: FK is on foreign table, query by __id
        const conflictingRecords = await db
          .selectFrom(group.fkHostTableName)
          .select([
            sql.ref(RECORD_ID_COLUMN).as('record_id'),
            sql.ref(group.selfKeyName).as('linked_to'),
          ])
          .where(RECORD_ID_COLUMN, 'in', [...group.foreignRecordIds])
          .where(group.selfKeyName, 'is not', null)
          .execute();

        if (conflictingRecords.length > 0) {
          const conflictingIds = conflictingRecords.map((r) => r.record_id as string);
          const message = i18nOrFallback(
            context.$t,
            tableI18nKeys.validation.link.one_many_duplicate,
            'Cannot link record(s): already linked to another record. In one-to-many relationships, each record can only belong to one parent.',
            undefined
          );
          const firstConstraint = group.constraints[0];
          return err(
            domainError.validation({
              message,
              code: 'validation.link.one_many_duplicate',
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
        const conflictingRecords = await db
          .selectFrom(group.fkHostTableName)
          .select([
            sql.ref(group.foreignKeyName).as('foreign_id'),
            sql.ref(group.selfKeyName).as('linked_to'),
          ])
          .where(group.foreignKeyName, 'in', [...group.foreignRecordIds])
          .where(group.selfKeyName, 'not in', [...group.sourceRecordIds]) // Exclude our own records
          .execute();

        if (conflictingRecords.length > 0) {
          const conflictingIds = conflictingRecords.map((r) => r.foreign_id as string);
          const message = i18nOrFallback(
            context.$t,
            tableI18nKeys.validation.link.one_many_duplicate,
            'Cannot link record(s): already linked to another record. In one-to-many relationships, each record can only belong to one parent.',
            undefined
          );
          const firstConstraint = group.constraints[0];
          return err(
            domainError.validation({
              message,
              code: 'validation.link.one_many_duplicate',
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
  /** The link field ID */
  fieldId: string;
  /** The relationship type */
  relationship: string;
  /** Whether it's a one-way link */
  isOneWay: boolean;
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
  baseId: string,
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
        'field.options as options',
      ])
      .where('table_meta.base_id', '=', baseId)
      .where('field.type', '=', 'link')
      .where('field.deleted_time', 'is', null)
      .where('field.is_lookup', 'is', null)
      .where(sql`(field.options::json->>'foreignTableId')::text`, '=', targetTableId)
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
        fieldId: row.field_id as string,
        relationship,
        isOneWay,
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

/**
 * Execute cleanup for incoming links - clean up FK/junction entries that point TO the deleted records.
 * Skips cleanup when fkHostTableName equals targetTableName AND it's not a self-referential link
 * (because the FK data will be deleted along with the records).
 */
const executeIncomingLinkCleanup = async (
  db: Kysely<DynamicDB>,
  recordIds: ReadonlyArray<string>,
  incomingFields: ReadonlyArray<IncomingLinkFieldInfo>,
  targetTableName: string,
  targetTableId: string
): Promise<Result<void, DomainError>> => {
  if (recordIds.length === 0 || incomingFields.length === 0) return ok(undefined);

  try {
    for (const field of incomingFields) {
      const {
        sourceTableId,
        relationship,
        isOneWay,
        fkHostTableName,
        foreignKeyName,
        orderColumnName,
      } = field;

      // Skip if FK is stored in the target table being deleted from
      // UNLESS it's a self-referential link (source table = target table)
      // For self-referential links, we need to nullify FKs in remaining records
      const isSelfReferential = sourceTableId === targetTableId;
      if (fkHostTableName === targetTableName && !isSelfReferential) continue;

      if (relationship === 'manyMany' || (relationship === 'oneMany' && isOneWay)) {
        // Junction table: delete rows where foreignKey matches deleted records
        await db
          .deleteFrom(fkHostTableName)
          .where(foreignKeyName, 'in', recordIds as string[])
          .execute();
      } else if (relationship === 'manyOne' || relationship === 'oneOne') {
        // FK on source table: nullify FK where it points to deleted records
        const updateValues: Record<string, null> = {
          [foreignKeyName]: null,
        };
        if (orderColumnName) {
          updateValues[orderColumnName] = null;
        }
        await db
          .updateTable(fkHostTableName)
          .set(updateValues)
          .where(foreignKeyName, 'in', recordIds as string[])
          .execute();
      }
      // For two-way oneMany: FK is on the target table (current table being deleted from),
      // which is handled by the outgoing link cleanup via FieldDeleteValueVisitor
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
  extraSeedMap: Map<string, { tableId: core.TableId; recordIds: Map<string, core.RecordId> }>
): Promise<Result<void, DomainError>> => {
  if (recordIds.length === 0 || incomingFields.length === 0) return ok(undefined);

  try {
    for (const field of incomingFields) {
      const {
        sourceTableId,
        relationship,
        isOneWay,
        fkHostTableName,
        foreignKeyName,
        selfKeyName,
      } = field;

      let sourceRecordIds: string[] = [];

      if (relationship === 'manyMany' || (relationship === 'oneMany' && isOneWay)) {
        // Junction table: find source records that link to deleted records
        if (!selfKeyName) continue;
        const rows = await db
          .selectFrom(fkHostTableName)
          .select(sql.ref(selfKeyName).as('source_id'))
          .where(foreignKeyName, 'in', recordIds as string[])
          .execute();
        sourceRecordIds = rows
          .map((r) => r.source_id)
          .filter((id): id is string => typeof id === 'string');
      } else if (relationship === 'manyOne' || relationship === 'oneOne') {
        // FK on source table: find source records that link to deleted records
        // The FK host table IS the source table
        const rows = await db
          .selectFrom(fkHostTableName)
          .select(sql.ref('__id').as('source_id'))
          .where(foreignKeyName, 'in', recordIds as string[])
          .execute();
        sourceRecordIds = rows
          .map((r) => r.source_id)
          .filter((id): id is string => typeof id === 'string');
      } else if (relationship === 'oneMany' && !isOneWay) {
        // Two-way oneMany (symmetric link): FK is on the target table (being deleted from)
        // The deleted records' FK values point to the source table records that need seeding
        // selfKeyName contains B's record IDs stored in A's FK column
        if (!selfKeyName) continue;
        const rows = await db
          .selectFrom(fkHostTableName)
          .select(sql.ref(selfKeyName).as('foreign_id'))
          .where('__id', 'in', recordIds as string[])
          .execute();
        sourceRecordIds = rows
          .map((r) => r.foreign_id)
          .filter((id): id is string => typeof id === 'string');
      }

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
