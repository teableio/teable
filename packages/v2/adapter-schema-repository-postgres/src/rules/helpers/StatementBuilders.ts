import { sql } from 'kysely';

import type { TableSchemaStatementBuilder } from '../core/ISchemaRule';

/**
 * Represents a table in the database with optional schema.
 */
export type TableIdentifier = {
  schema: string | null;
  tableName: string;
};

/**
 * Builds a qualified table reference for SQL statements.
 */
export const buildTableIdentifier = (target: TableIdentifier) => {
  if (!target.schema) return sql.ref(target.tableName);
  return sql`${sql.ref(target.schema)}.${sql.ref(target.tableName)}`;
};

/** Compress multi-line SQL into single line for cleaner logs */
export const compressSql = (sqlStr: string): string => sqlStr.replace(/\s+/g, ' ').trim();

/**
 * Creates a DROP COLUMN statement.
 */
export const dropColumnStatement = (
  target: TableIdentifier,
  columnName: string
): TableSchemaStatementBuilder =>
  sql`alter table ${buildTableIdentifier(target)} drop column if exists ${sql.ref(columnName)} cascade`;

/**
 * Creates a DROP TABLE statement.
 */
export const dropTableStatement = (target: TableIdentifier): TableSchemaStatementBuilder =>
  sql`drop table if exists ${buildTableIdentifier(target)} cascade`;

/**
 * Creates a DROP INDEX statement.
 */
export const dropIndexStatement = (
  target: TableIdentifier,
  indexName: string
): TableSchemaStatementBuilder => {
  if (!target.schema) {
    return sql`drop index if exists ${sql.ref(indexName)}`;
  }
  return sql`drop index if exists ${sql.ref(target.schema)}.${sql.ref(indexName)}`;
};

/**
 * Creates a DROP CONSTRAINT statement.
 */
export const dropConstraintStatement = (
  target: TableIdentifier,
  constraintName: string
): TableSchemaStatementBuilder =>
  sql`alter table if exists ${buildTableIdentifier(target)} drop constraint if exists ${sql.ref(constraintName)}`;

/**
 * Creates a CREATE INDEX statement.
 */
export const createIndexStatement = (
  target: TableIdentifier,
  indexName: string,
  columnName: string
): TableSchemaStatementBuilder =>
  sql`create index if not exists ${sql.ref(indexName)} on ${buildTableIdentifier(target)} (${sql.ref(columnName)})`;

/**
 * Creates a CREATE UNIQUE INDEX statement.
 */
export const createUniqueIndexStatement = (
  target: TableIdentifier,
  indexName: string,
  columnName: string
): TableSchemaStatementBuilder =>
  sql`create unique index if not exists ${sql.ref(indexName)} on ${buildTableIdentifier(target)} (${sql.ref(columnName)})`;

/**
 * Creates a FK constraint statement that checks if the target table exists first.
 * Uses a PL/pgSQL DO block to conditionally add the constraint.
 */
export const createForeignKeyConstraintStatement = (
  sourceTable: TableIdentifier,
  constraintName: string,
  columnName: string,
  targetTable: TableIdentifier,
  targetColumn: string,
  onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' = 'CASCADE'
): TableSchemaStatementBuilder => {
  const sourceTableFull = sourceTable.schema
    ? `"${sourceTable.schema}"."${sourceTable.tableName}"`
    : `"${sourceTable.tableName}"`;
  const targetTableFull = targetTable.schema
    ? `"${targetTable.schema}"."${targetTable.tableName}"`
    : `"${targetTable.tableName}"`;
  const targetSchema = targetTable.schema ?? 'public';

  return sql.raw(
    compressSql(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = '${targetSchema}' 
          AND table_name = '${targetTable.tableName}'
        ) THEN
          BEGIN
            ALTER TABLE ${sourceTableFull} 
            ADD CONSTRAINT "${constraintName}" 
            FOREIGN KEY ("${columnName}") 
            REFERENCES ${targetTableFull} ("${targetColumn}") 
            ON DELETE ${onDelete};
          EXCEPTION WHEN duplicate_object THEN
            NULL;
          END;
        END IF;
      END
      $$;
    `)
  );
};

/**
 * Creates an ADD GENERATED COLUMN statement.
 */
export const addGeneratedColumnStatement = (
  target: TableIdentifier,
  columnName: string,
  definition: ReturnType<typeof sql>
): TableSchemaStatementBuilder =>
  sql`alter table ${buildTableIdentifier(target)} add column if not exists ${sql.ref(
    columnName
  )} ${definition}`;
