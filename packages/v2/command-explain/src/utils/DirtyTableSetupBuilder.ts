import type { TableId, RecordId } from '@teable/v2-core';
import type { SetupStatement } from './SqlExplainRunner';

const DIRTY_TABLE = 'tmp_computed_dirty';
const DIRTY_TABLE_ID_COL = 'table_id';
const DIRTY_RECORD_ID_COL = 'record_id';

/**
 * Build setup statements to create and populate the tmp_computed_dirty table
 * for EXPLAIN ANALYZE to work with computed field updates.
 */
export function buildDirtyTableSetupStatements(
  seedTableId: TableId,
  seedRecordIds: ReadonlyArray<RecordId>
): SetupStatement[] {
  const statements: SetupStatement[] = [];

  // 1. Create temporary table
  statements.push({
    description: 'Create temporary dirty tracking table',
    sql: `CREATE TEMPORARY TABLE "${DIRTY_TABLE}" (
      ${DIRTY_TABLE_ID_COL} text NOT NULL,
      ${DIRTY_RECORD_ID_COL} text NOT NULL,
      PRIMARY KEY (${DIRTY_TABLE_ID_COL}, ${DIRTY_RECORD_ID_COL})
    ) ON COMMIT DROP`,
  });

  // 2. Insert seed records
  if (seedRecordIds.length > 0) {
    const values = seedRecordIds
      .map((recordId) => `('${seedTableId.toString()}', '${recordId.toString()}')`)
      .join(', ');

    statements.push({
      description: `Insert ${seedRecordIds.length} seed record(s) into dirty table`,
      sql: `INSERT INTO "${DIRTY_TABLE}" ("${DIRTY_TABLE_ID_COL}", "${DIRTY_RECORD_ID_COL}") VALUES ${values} ON CONFLICT DO NOTHING`,
    });
  }

  return statements;
}

/**
 * Build setup statements including dirty record propagation.
 * This is needed when the computed update involves cross-table dependencies.
 */
export function buildDirtyTableSetupWithPropagation(
  seedTableId: TableId,
  seedRecordIds: ReadonlyArray<RecordId>,
  propagationStatements?: ReadonlyArray<{ tableId: TableId; sql: string; description: string }>
): SetupStatement[] {
  const statements = buildDirtyTableSetupStatements(seedTableId, seedRecordIds);

  // Add propagation statements if provided
  if (propagationStatements) {
    for (const prop of propagationStatements) {
      statements.push({
        description: prop.description,
        sql: prop.sql,
      });
    }
  }

  return statements;
}
