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
