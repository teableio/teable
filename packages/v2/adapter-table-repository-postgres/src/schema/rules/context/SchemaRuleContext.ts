import type { Field, Table } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';

import type { SchemaIntrospector } from './SchemaIntrospector';

/**
 * Context object passed to schema rules during execution.
 * Contains all the information and dependencies a rule needs to:
 * - Generate SQL statements (up/down)
 * - Validate current database state (isValid)
 */
export interface SchemaRuleContext {
  /** Kysely database instance for generating SQL statements */
  readonly db: Kysely<V1TeableDatabase>;

  /** Kysely database instance for metadata tables such as field/reference */
  readonly metaDb: Kysely<V1TeableDatabase>;

  /** Introspector for querying current database schema state */
  readonly introspector: SchemaIntrospector;

  /** PostgreSQL schema name (null for default/public schema) */
  readonly schema: string | null;

  /** Physical table name in the database */
  readonly tableName: string;

  /** Logical table ID (used for references and metadata) */
  readonly tableId: string;

  /** The field this rule applies to, if the rule is field-scoped */
  readonly field?: Field;

  /** Optional: The full table aggregate, for rules that need table-level info */
  readonly table?: Table;

  /**
   * Operation mode that controls rule behavior.
   * - 'delete': field is being permanently removed — rules should clean up all related data
   * - 'update': field is being converted/renamed — rules should only clean up owned data
   * Defaults to 'update' when not specified.
   */
  readonly mode?: 'delete' | 'update';

  /**
   * True when applying schema rules to brand-new empty physical tables.
   * Rules may skip repair/backfill statements for existing rows while keeping
   * structural DDL and metadata writes intact.
   */
  readonly optimizeForEmptyTables?: boolean;

  /**
   * True when another live field maps to the same physical column (db field
   * name collision). Rules must keep the column on delete — dropping it would
   * destroy the surviving field's data.
   */
  readonly preserveSharedColumn?: boolean;

  /**
   * Optional per checker/repairer session cache for expensive cross-table lookups
   * (e.g. active link storage refs). Shared across tables in one base integrity run.
   */
  readonly sessionCache?: Map<string, unknown>;
}

/**
 * Creates a schema rule context with the given parameters.
 */
export const createSchemaRuleContext = (params: {
  db: Kysely<V1TeableDatabase>;
  metaDb?: Kysely<V1TeableDatabase>;
  introspector: SchemaIntrospector;
  schema: string | null;
  tableName: string;
  tableId: string;
  field?: Field;
  table?: Table;
  mode?: 'delete' | 'update';
  optimizeForEmptyTables?: boolean;
  preserveSharedColumn?: boolean;
  sessionCache?: Map<string, unknown>;
}): SchemaRuleContext => ({
  db: params.db,
  metaDb: params.metaDb ?? params.db,
  introspector: params.introspector,
  schema: params.schema,
  tableName: params.tableName,
  tableId: params.tableId,
  field: params.field,
  table: params.table,
  mode: params.mode,
  optimizeForEmptyTables: params.optimizeForEmptyTables,
  preserveSharedColumn: params.preserveSharedColumn,
  sessionCache: params.sessionCache,
});
