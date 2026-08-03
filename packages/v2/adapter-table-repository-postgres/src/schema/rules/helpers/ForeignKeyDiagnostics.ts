import { domainError, type DomainError } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import { quoteIdentifier, quoteTableIdentifier, type TableIdentifier } from './StatementBuilders';

export const countOrphanForeignKeyRows = async (
  db: Kysely<V1TeableDatabase>,
  sourceTable: TableIdentifier,
  sourceColumn: string,
  targetTable: TableIdentifier,
  targetColumn: string
): Promise<Result<number, DomainError>> => {
  try {
    const sourceTableRef = quoteTableIdentifier(sourceTable);
    const targetTableRef = quoteTableIdentifier(targetTable);
    const sourceColumnRef = quoteIdentifier(sourceColumn);
    const targetColumnRef = quoteIdentifier(targetColumn);

    const result = await sql<{ orphan_count: number }>`
      SELECT COUNT(*)::int AS orphan_count
      FROM ${sql.raw(sourceTableRef)} AS source_rows
      WHERE ${sql.raw(`source_rows.${sourceColumnRef}`)} IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM ${sql.raw(targetTableRef)} AS target_rows
          WHERE ${sql.raw(`target_rows.${targetColumnRef}`)} = ${sql.raw(
            `source_rows.${sourceColumnRef}`
          )}
        )
    `.execute(db);

    return ok(result.rows[0]?.orphan_count ?? 0);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to inspect orphan foreign key rows: ${error instanceof Error ? error.message : String(error)}`,
        code: 'schema.introspection_failed',
        details: {
          sourceTable,
          sourceColumn,
          targetTable,
          targetColumn,
        },
      })
    );
  }
};

export const foreignKeyExistsForColumnTarget = async (
  db: Kysely<V1TeableDatabase>,
  sourceTable: TableIdentifier,
  sourceColumn: string,
  targetTable: TableIdentifier,
  targetColumn: string
): Promise<Result<boolean, DomainError>> => {
  try {
    const sourceSchema = sourceTable.schema ?? 'public';
    const targetSchema = targetTable.schema ?? 'public';

    const result = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint con
        JOIN pg_class source_table
          ON source_table.oid = con.conrelid
        JOIN pg_namespace source_schema
          ON source_schema.oid = source_table.relnamespace
        JOIN pg_class target_table
          ON target_table.oid = con.confrelid
        JOIN pg_namespace target_schema
          ON target_schema.oid = target_table.relnamespace
        JOIN unnest(con.conkey) WITH ORDINALITY AS source_key(attnum, ord)
          ON true
        JOIN unnest(con.confkey) WITH ORDINALITY AS target_key(attnum, ord)
          ON target_key.ord = source_key.ord
        JOIN pg_attribute source_attr
          ON source_attr.attrelid = source_table.oid
          AND source_attr.attnum = source_key.attnum
        JOIN pg_attribute target_attr
          ON target_attr.attrelid = target_table.oid
          AND target_attr.attnum = target_key.attnum
        WHERE con.contype = 'f'
          AND array_length(con.conkey, 1) = 1
          AND array_length(con.confkey, 1) = 1
          AND source_schema.nspname = ${sourceSchema}
          AND source_table.relname = ${sourceTable.tableName}
          AND source_attr.attname = ${sourceColumn}
          AND target_schema.nspname = ${targetSchema}
          AND target_table.relname = ${targetTable.tableName}
          AND target_attr.attname = ${targetColumn}
      ) AS exists
    `.execute(db);

    return ok(result.rows[0]?.exists ?? false);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to inspect foreign key shape: ${error instanceof Error ? error.message : String(error)}`,
        code: 'schema.introspection_failed',
        details: {
          sourceTable,
          sourceColumn,
          targetTable,
          targetColumn,
        },
      })
    );
  }
};
