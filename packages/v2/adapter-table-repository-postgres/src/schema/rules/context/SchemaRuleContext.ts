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

  /** Introspector for querying current database schema state */
  readonly introspector: SchemaIntrospector;

  /** PostgreSQL schema name (null for default/public schema) */
  readonly schema: string | null;

  /** Physical table name in the database */
  readonly tableName: string;

  /** Logical table ID (used for references and metadata) */
  readonly tableId: string;

  /** The field this rule applies to */
  readonly field: Field;

  /** Optional: The full table aggregate, for rules that need table-level info */
  readonly table?: Table;
}

/**
 * Creates a schema rule context with the given parameters.
 */
export const createSchemaRuleContext = (params: {
  db: Kysely<V1TeableDatabase>;
  introspector: SchemaIntrospector;
  schema: string | null;
  tableName: string;
  tableId: string;
  field: Field;
  table?: Table;
}): SchemaRuleContext => ({
  db: params.db,
  introspector: params.introspector,
  schema: params.schema,
  tableName: params.tableName,
  tableId: params.tableId,
  field: params.field,
  table: params.table,
});
