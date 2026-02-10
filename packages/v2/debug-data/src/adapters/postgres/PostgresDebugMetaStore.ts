import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { domainError, type BaseId, type FieldId, type TableId } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { err, ok } from 'neverthrow';

import type { IDebugMetaStore } from '../../ports/DebugMetaStore';
import type {
  DebugFieldMeta,
  DebugFieldSummary,
  DebugJsonField,
  DebugTableMeta,
  DebugTableSummary,
} from '../../types';

const TABLE_META_SELECT = [
  'id',
  'base_id',
  'name',
  'description',
  'icon',
  'db_table_name',
  'db_view_name',
  'version',
  'order',
  'created_time',
  'created_by',
  'last_modified_time',
  'last_modified_by',
  'deleted_time',
] as const;

const TABLE_META_SUMMARY_SELECT = ['id', 'base_id', 'name', 'db_table_name'] as const;

const FIELD_META_SELECT = [
  'f.id as id',
  'f.table_id as table_id',
  't.name as table_name',
  't.base_id as base_id',
  'f.name as name',
  'f.description as description',
  'f.options as options',
  'f.meta as meta',
  'f.ai_config as ai_config',
  'f.type as type',
  'f.cell_value_type as cell_value_type',
  'f.is_multiple_cell_value as is_multiple_cell_value',
  'f.db_field_type as db_field_type',
  'f.db_field_name as db_field_name',
  'f.not_null as not_null',
  'f.unique as unique',
  'f.is_primary as is_primary',
  'f.is_computed as is_computed',
  'f.is_lookup as is_lookup',
  'f.is_conditional_lookup as is_conditional_lookup',
  'f.is_pending as is_pending',
  'f.has_error as has_error',
  'f.lookup_linked_field_id as lookup_linked_field_id',
  'f.lookup_options as lookup_options',
  'f.order as order',
  'f.version as version',
  'f.created_time as created_time',
  'f.created_by as created_by',
  'f.last_modified_time as last_modified_time',
  'f.last_modified_by as last_modified_by',
  'f.deleted_time as deleted_time',
] as const;

const FIELD_SUMMARY_SELECT = [
  'f.id as id',
  'f.table_id as table_id',
  't.name as table_name',
  't.base_id as base_id',
  'f.name as name',
  'f.type as type',
  'f.is_primary as is_primary',
  'f.is_computed as is_computed',
  'f.is_lookup as is_lookup',
  'f.is_pending as is_pending',
  'f.has_error as has_error',
] as const;

const FIELD_JSON_LABELS = {
  options: 'field.options',
  lookupOptions: 'field.lookup_options',
  meta: 'field.meta',
  aiConfig: 'field.ai_config',
} as const;

const FIELD_TABLE = 'field as f';
const TABLE_META_TABLE = 'table_meta as t';
const TABLE_META_JOIN_KEY = 't.id';
const FIELD_TABLE_ID_KEY = 'f.table_id';

@injectable()
export class PostgresDebugMetaStore implements IDebugMetaStore {
  constructor(
    @inject(v2PostgresDbTokens.db)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  async getTableMeta(tableId: TableId) {
    try {
      const row = await this.db
        .selectFrom('table_meta')
        .select(TABLE_META_SELECT)
        .where('id', '=', tableId.toString())
        .executeTakeFirst();

      if (!row) return ok(null);
      return ok(mapTableMeta(row));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to load table_meta: ${describeError(error)}`,
        })
      );
    }
  }

  async getTablesByBaseId(baseId: BaseId) {
    try {
      const rows = await this.db
        .selectFrom('table_meta')
        .select(TABLE_META_SELECT)
        .where('base_id', '=', baseId.toString())
        .orderBy('order', 'asc')
        .execute();

      return ok(rows.map(mapTableMeta));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to load table_meta list: ${describeError(error)}`,
        })
      );
    }
  }

  async getTableSummary(tableId: TableId) {
    try {
      const row = await this.db
        .selectFrom('table_meta')
        .select(TABLE_META_SUMMARY_SELECT)
        .where('id', '=', tableId.toString())
        .executeTakeFirst();

      if (!row) return ok(null);
      return ok(mapTableSummary(row));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to load table_meta summary: ${describeError(error)}`,
        })
      );
    }
  }

  async getTableSummariesByIds(tableIds: ReadonlyArray<TableId>) {
    if (tableIds.length === 0) return ok([]);
    try {
      const ids = tableIds.map((id) => id.toString());
      const rows = await this.db
        .selectFrom('table_meta')
        .select(TABLE_META_SUMMARY_SELECT)
        .where('id', 'in', ids)
        .execute();

      return ok(rows.map(mapTableSummary));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to load table_meta summaries: ${describeError(error)}`,
        })
      );
    }
  }

  async getField(fieldId: FieldId) {
    try {
      const row = await this.db
        .selectFrom(FIELD_TABLE)
        .innerJoin(TABLE_META_TABLE, TABLE_META_JOIN_KEY, FIELD_TABLE_ID_KEY)
        .select(FIELD_META_SELECT)
        .where('f.id', '=', fieldId.toString())
        .executeTakeFirst();

      if (!row) return ok(null);
      return ok(mapFieldMeta(row));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to load field: ${describeError(error)}`,
        })
      );
    }
  }

  async getFieldsByTableId(tableId: TableId) {
    try {
      const rows = await this.db
        .selectFrom(FIELD_TABLE)
        .innerJoin(TABLE_META_TABLE, TABLE_META_JOIN_KEY, FIELD_TABLE_ID_KEY)
        .select(FIELD_META_SELECT)
        .where('f.table_id', '=', tableId.toString())
        .orderBy('f.order', 'asc')
        .execute();

      return ok(rows.map(mapFieldMeta));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to load fields: ${describeError(error)}`,
        })
      );
    }
  }

  async getFieldSummariesByIds(fieldIds: ReadonlyArray<FieldId>) {
    if (fieldIds.length === 0) return ok([]);
    try {
      const ids = fieldIds.map((id) => id.toString());
      const rows = await this.db
        .selectFrom(FIELD_TABLE)
        .innerJoin(TABLE_META_TABLE, TABLE_META_JOIN_KEY, FIELD_TABLE_ID_KEY)
        .select(FIELD_SUMMARY_SELECT)
        .where('f.id', 'in', ids)
        .execute();

      return ok(rows.map(mapFieldSummary));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to load field summaries: ${describeError(error)}`,
        })
      );
    }
  }
}

const mapTableMeta = (row: {
  id: string;
  base_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  db_table_name: string;
  db_view_name: string | null;
  version: number;
  order: number;
  created_time: Date;
  created_by: string;
  last_modified_time: Date | null;
  last_modified_by: string | null;
  deleted_time: Date | null;
}): DebugTableMeta => ({
  id: row.id,
  baseId: row.base_id,
  name: row.name,
  description: row.description,
  icon: row.icon,
  dbTableName: row.db_table_name,
  dbViewName: row.db_view_name,
  version: row.version,
  order: row.order,
  createdTime: row.created_time.toISOString(),
  createdBy: row.created_by,
  lastModifiedTime: row.last_modified_time ? row.last_modified_time.toISOString() : null,
  lastModifiedBy: row.last_modified_by,
  deletedTime: row.deleted_time ? row.deleted_time.toISOString() : null,
});

const mapTableSummary = (row: {
  id: string;
  base_id: string;
  name: string;
  db_table_name: string;
}): DebugTableSummary => ({
  id: row.id,
  baseId: row.base_id,
  name: row.name,
  dbTableName: row.db_table_name,
});

const mapFieldMeta = (row: {
  id: string;
  table_id: string;
  table_name: string;
  base_id: string;
  name: string;
  description: string | null;
  options: string | null;
  meta: string | null;
  ai_config: string | null;
  type: string;
  cell_value_type: string;
  is_multiple_cell_value: boolean | null;
  db_field_type: string;
  db_field_name: string;
  not_null: boolean | null;
  unique: boolean | null;
  is_primary: boolean | null;
  is_computed: boolean | null;
  is_lookup: boolean | null;
  is_conditional_lookup: boolean | null;
  is_pending: boolean | null;
  has_error: boolean | null;
  lookup_linked_field_id: string | null;
  lookup_options: string | null;
  order: number;
  version: number;
  created_time: Date;
  created_by: string;
  last_modified_time: Date | null;
  last_modified_by: string | null;
  deleted_time: Date | null;
}): DebugFieldMeta => ({
  id: row.id,
  tableId: row.table_id,
  tableName: row.table_name,
  baseId: row.base_id,
  name: row.name,
  description: row.description,
  type: row.type,
  cellValueType: row.cell_value_type,
  isMultipleCellValue: row.is_multiple_cell_value,
  dbFieldType: row.db_field_type,
  dbFieldName: row.db_field_name,
  notNull: row.not_null,
  unique: row.unique,
  isPrimary: row.is_primary,
  isComputed: row.is_computed,
  isLookup: row.is_lookup,
  isConditionalLookup: row.is_conditional_lookup,
  isPending: row.is_pending,
  hasError: row.has_error,
  lookupLinkedFieldId: row.lookup_linked_field_id,
  order: row.order,
  version: row.version,
  createdTime: row.created_time.toISOString(),
  createdBy: row.created_by,
  lastModifiedTime: row.last_modified_time ? row.last_modified_time.toISOString() : null,
  lastModifiedBy: row.last_modified_by,
  deletedTime: row.deleted_time ? row.deleted_time.toISOString() : null,
  options: parseJsonField(row.options, FIELD_JSON_LABELS.options),
  lookupOptions: parseJsonField(row.lookup_options, FIELD_JSON_LABELS.lookupOptions),
  meta: parseJsonField(row.meta, FIELD_JSON_LABELS.meta),
  aiConfig: parseJsonField(row.ai_config, FIELD_JSON_LABELS.aiConfig),
});

const mapFieldSummary = (row: {
  id: string;
  table_id: string;
  table_name: string;
  base_id: string;
  name: string;
  type: string;
  is_primary: boolean | null;
  is_computed: boolean | null;
  is_lookup: boolean | null;
  is_pending: boolean | null;
  has_error: boolean | null;
}): DebugFieldSummary => ({
  id: row.id,
  tableId: row.table_id,
  tableName: row.table_name,
  baseId: row.base_id,
  name: row.name,
  type: row.type,
  isPrimary: row.is_primary,
  isComputed: row.is_computed,
  isLookup: row.is_lookup,
  isPending: row.is_pending,
  hasError: row.has_error,
});

const parseJsonField = (raw: string | null, label: string): DebugJsonField => {
  if (!raw) {
    return { raw: null, parsed: null, parseError: null };
  }
  try {
    return { raw, parsed: JSON.parse(raw), parseError: null };
  } catch (error) {
    return { raw, parsed: null, parseError: `Invalid JSON for ${label}: ${describeError(error)}` };
  }
};

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message ? `${error.name}: ${error.message}` : error.name;
  }
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    return json ?? String(error);
  } catch {
    return String(error);
  }
};
