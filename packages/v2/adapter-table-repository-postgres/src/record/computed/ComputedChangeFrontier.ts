import { CellValueType, FieldType, FormulaField, type Field, type Table } from '@teable/v2-core';
import { analyzeDeterministicScalarFormula } from '@teable/v2-formula-sql-pg';
import { sql, type Kysely } from 'kysely';
import type { DynamicDB } from '../query-builder';
import type { StepChangeData, ComputedCellLimitRejection } from './ComputedFieldUpdater';
import type { ComputedUpdatePlan } from './ComputedUpdatePlanner';

export const clearChangeFrontier = async (
  db: Kysely<DynamicDB>,
  scopeId: string,
  retainedTableIds: ReadonlyArray<string> = []
): Promise<void> => {
  let query = db.deleteFrom(CHANGE_FRONTIER_TABLE).where('scope_id', '=', scopeId);
  if (retainedTableIds.length) query = query.where('table_id', 'not in', retainedTableIds);
  await query.execute();
};

export const CHANGE_FRONTIER_TABLE = 'computed_update_change_frontier';

/** Conservative first coverage: deterministic scalar formulas only. */
export const supportsValueFrontier = (field: Field, table: Table): boolean => {
  if (!(field instanceof FormulaField) || field.isPersistedAsGeneratedColumn().unwrapOr(true))
    return false;
  if (
    field
      .isMultipleCellValue()
      .map((value) => value.isMultiple())
      .unwrapOr(true)
  )
    return false;
  const type = field.cellValueType();
  if (
    type.isErr() ||
    ![CellValueType.number(), CellValueType.string(), CellValueType.boolean()].some((value) =>
      value.equals(type.value)
    )
  )
    return false;
  const references = field.expression().getReferencedFieldIds();
  if (references.isErr()) return false;
  if (
    !references.value.every((reference) => {
      const dependency = table.getFields((candidate) => candidate.id().equals(reference))[0];
      return (
        dependency !== undefined &&
        [
          FieldType.number(),
          FieldType.singleLineText(),
          FieldType.longText(),
          FieldType.checkbox(),
        ].some((type) => dependency.type().equals(type))
      );
    })
  )
    return false;
  const analyzed = analyzeDeterministicScalarFormula(field.expression().toString(), {
    isStoredDateField: () => false,
  });
  return analyzed.isOk() && analyzed.value !== undefined;
};

/**
 * Monotonic change evidence is independent of dirty/progress bookkeeping.
 * Called inside the stage transaction AFTER rejected values were restored.
 * Only field/row identifiers cross into SQL, bounded by this execution batch.
 */
export const recordStageValueChanges = async (
  db: Kysely<DynamicDB>,
  scopeId: string,
  plan: ComputedUpdatePlan,
  tables: ReadonlyMap<string, Table>,
  changes: ReadonlyArray<StepChangeData>,
  rejected: ReadonlyArray<ComputedCellLimitRejection> = [],
  candidateTableIds?: ReadonlyArray<string>
): Promise<void> => {
  if (candidateTableIds?.length === 0) return;
  const fieldsByTable = new Map<string, Set<string>>();
  for (const step of plan.steps) {
    const key = step.tableId.toString();
    if (candidateTableIds && !candidateTableIds.includes(key)) continue;
    const fields = fieldsByTable.get(key) ?? new Set<string>();
    step.fieldIds.forEach((field) => fields.add(field.toString()));
    fieldsByTable.set(key, fields);
  }
  const unsupportedTables = [...fieldsByTable]
    .filter(([tableId, fieldIds]) => {
      const table = tables.get(tableId);
      return (
        !table ||
        ![...fieldIds].every((id) => {
          const field = table.getFields((candidate) => candidate.id().toString() === id)[0];
          return field && supportsValueFrontier(field, table);
        })
      );
    })
    .map(([tableId]) => tableId);
  if (unsupportedTables.length > 0) {
    // Metadata can change between partial batches. Preserve fallback only for
    // scopes with existing evidence; untouched unsupported tables create none.
    await sql`INSERT INTO ${sql.table(CHANGE_FRONTIER_TABLE)} (scope_id, kind, table_id, record_id, field_id)
      SELECT DISTINCT ${scopeId}, 'fallback', table_id, '', '' FROM ${sql.table(CHANGE_FRONTIER_TABLE)}
      WHERE scope_id = ${scopeId} AND table_id IN (${sql.join(unsupportedTables)})
      ON CONFLICT DO NOTHING`.execute(db);
    unsupportedTables.forEach((tableId) => fieldsByTable.delete(tableId));
  }
  if (fieldsByTable.size === 0) return;
  // Explicit sources migrate to the durable frontier before floor execution.
  // No input and no verified scope state is schema-wide initialization, even
  // when seedAllTableIds was omitted; it cannot acquire value-pruning coverage.
  const sourceEvidence = await sql<{ present: boolean }>`SELECT EXISTS (
    SELECT 1 FROM computed_update_stage_ledger WHERE scope_id = ${scopeId}
      AND kind IN ('frontier', 'consumed')
    UNION ALL
    SELECT 1 FROM ${sql.table(CHANGE_FRONTIER_TABLE)} WHERE scope_id = ${scopeId} AND kind = 'covered'
  ) AS present`.execute(db);
  const hasMutationInput =
    plan.seedRecordIds.length > 0 ||
    plan.extraSeedRecords.some((group) => group.recordIds.length > 0) ||
    sourceEvidence.rows[0]?.present === true;
  const trackedTables = new Set<string>();
  for (const [tableId, fieldIds] of fieldsByTable) {
    const table = tables.get(tableId);
    const eligible =
      hasMutationInput &&
      plan.changeType === 'update' &&
      Boolean(plan.changedFieldIds?.length) &&
      !plan.seedAllTableIds?.length &&
      !plan.cycleInfo &&
      table !== undefined;
    // An old-version partial stage may already have processed rows without
    // recording values. Such a scope can never be upgraded to covered midway.
    await sql`INSERT INTO ${sql.table(CHANGE_FRONTIER_TABLE)} (scope_id, kind, table_id, record_id, field_id)
      SELECT ${scopeId}, 'fallback', ${tableId}, '', ''
      WHERE (${!eligible} AND EXISTS (SELECT 1 FROM ${sql.table(CHANGE_FRONTIER_TABLE)}
        WHERE scope_id = ${scopeId} AND table_id = ${tableId})) OR (
        EXISTS (SELECT 1 FROM ${sql.table(CHANGE_FRONTIER_TABLE)}
          WHERE scope_id = ${scopeId} AND table_id = ${tableId} AND kind = 'covered')
        AND (
          (SELECT count(*) FROM ${sql.table(CHANGE_FRONTIER_TABLE)}
            WHERE scope_id = ${scopeId} AND table_id = ${tableId} AND kind = 'covered') <> ${fieldIds.size}
          OR EXISTS (SELECT 1 FROM ${sql.table(CHANGE_FRONTIER_TABLE)}
            WHERE scope_id = ${scopeId} AND table_id = ${tableId} AND kind = 'covered'
              AND field_id NOT IN (${sql.join([...fieldIds])}))
        )
      ) OR (
        EXISTS (SELECT 1 FROM computed_update_stage_ledger
          WHERE scope_id = ${scopeId} AND table_id = ${tableId} AND kind = 'excluded')
        AND (SELECT count(*) FROM ${sql.table(CHANGE_FRONTIER_TABLE)}
          WHERE scope_id = ${scopeId} AND table_id = ${tableId} AND kind = 'covered'
            AND field_id IN (${sql.join([...fieldIds])})) < ${fieldIds.size}
      ) ON CONFLICT DO NOTHING`.execute(db);
    if (!eligible) continue;
    trackedTables.add(tableId);
    // Required for mixed-version workers: a legacy worker may process another
    // partial batch AFTER our coverage marker was created. Final collection
    // proves every candidate/processed row has evidence, not just the first.
    await sql`INSERT INTO ${sql.table(CHANGE_FRONTIER_TABLE)} (scope_id, kind, table_id, record_id, field_id)
      SELECT ${scopeId}, 'processed', ${tableId}, record_id, ''
      FROM pg_temp.tmp_computed_dirty WHERE table_id = ${tableId}
      ON CONFLICT DO NOTHING`.execute(db);
    await sql`INSERT INTO ${sql.table(CHANGE_FRONTIER_TABLE)} (scope_id, kind, table_id, record_id, field_id)
      SELECT ${scopeId}, 'covered', ${tableId}, '', field_id
      FROM jsonb_array_elements_text(${JSON.stringify([...fieldIds])}::jsonb) AS f(field_id)
      ON CONFLICT DO NOTHING`.execute(db);
  }
  const cells: Array<{ table_id: string; record_id: string; field_id: string }> = [];
  for (const step of changes) {
    if (!trackedTables.has(step.tableId)) continue;
    for (const record of step.recordChanges) {
      for (const change of record.changes) {
        // Values came from stored columns in UPDATE RETURNING, not uncast
        // formula outputs. Primitive equality is safe for the covered scalar
        // types; other representations conservatively count as changed.
        if (change.oldValue !== undefined && Object.is(change.oldValue, change.newValue)) continue;
        cells.push({
          table_id: step.tableId,
          record_id: record.recordId,
          field_id: change.fieldId,
        });
      }
    }
  }
  // Collapsed dependents saw the pre-revert value, so these cells MUST trigger
  // downstream correction even when stored old/new values are now equal.
  for (const cell of rejected)
    if (trackedTables.has(cell.tableId))
      cells.push({ table_id: cell.tableId, record_id: cell.recordId, field_id: cell.fieldId });
  for (let offset = 0; offset < cells.length; offset += 1000) {
    await sql`INSERT INTO ${sql.table(CHANGE_FRONTIER_TABLE)} (scope_id, kind, table_id, record_id, field_id)
      SELECT ${scopeId}, 'changed', c.table_id, c.record_id, c.field_id
      FROM jsonb_to_recordset(${JSON.stringify(cells.slice(offset, offset + 1000))}::jsonb)
        AS c(table_id text, record_id text, field_id text)
      ON CONFLICT DO NOTHING`.execute(db);
  }
};

/**
 * Maintenance only: bounded index seeks across scopes, then at most 1,000 rows.
 * The outbox id/scope indexes preserve active children after their root task
 * has been deleted. No age-based eviction of live change evidence is allowed.
 */
export const cleanupChangeFrontierOrphans = async (
  db: Kysely<DynamicDB>,
  afterScope = ''
): Promise<{ afterScope: string; deleted: number }> => {
  const result = await sql<{ after_scope: string | null; deleted: number | string }>`
    WITH RECURSIVE scopes AS (
      (SELECT scope_id, 1 AS depth FROM ${sql.table(CHANGE_FRONTIER_TABLE)}
       WHERE scope_id > ${afterScope} ORDER BY scope_id LIMIT 1)
      UNION ALL
      SELECT n.scope_id, s.depth + 1 FROM scopes s
      CROSS JOIN LATERAL (
        SELECT scope_id FROM ${sql.table(CHANGE_FRONTIER_TABLE)}
        WHERE scope_id > s.scope_id ORDER BY scope_id LIMIT 1
      ) n WHERE s.depth < 8
    ), orphan_scopes AS (
      SELECT scope_id FROM scopes s WHERE NOT EXISTS (
        SELECT 1 FROM computed_update_outbox o
        WHERE o.id = s.scope_id OR o.dirty_stats->>'ledgerScopeId' = s.scope_id
      )
    ), removed AS (
      DELETE FROM ${sql.table(CHANGE_FRONTIER_TABLE)} WHERE ctid IN (
        SELECT f.ctid FROM ${sql.table(CHANGE_FRONTIER_TABLE)} f
        INNER JOIN orphan_scopes s ON s.scope_id = f.scope_id LIMIT 1000
      ) RETURNING 1
    )
    SELECT (SELECT max(scope_id) FROM scopes) AS after_scope,
      (SELECT count(*) FROM removed) AS deleted
  `.execute(db);
  return {
    afterScope: result.rows[0]?.after_scope ?? '',
    deleted: Number(result.rows[0]?.deleted ?? 0),
  };
};
