import { sql, type Kysely } from 'kysely';
import { resolveTableName, resolveTableSql } from '../../../shared/sqlIdentifiers';
import type { DynamicDB } from '../../query-builder';
import type { ComputedUpdateOutboxItem } from './ComputedUpdateOutboxPayload';

export const DEAD_LETTER_SEED_TABLE = 'computed_update_dead_letter_seed';

/** Copies membership inside the terminal transaction; no ledger record IDs enter JS. */
export const archiveComputedRerunSeeds = async (
  db: Kysely<DynamicDB>,
  task: ComputedUpdateOutboxItem,
  groups: ReadonlyArray<{ tableId: string; recordIds: ReadonlyArray<string> }>
): Promise<{ version: 1; complete: boolean; seedCount: string } | undefined> => {
  const exists = await sql<{
    present: boolean;
  }>`select to_regclass(${resolveTableName(db, DEAD_LETTER_SEED_TABLE)}) is not null as present`.execute(
    db
  );
  // Additive rollout: retain failure evidence even before the migration; recovery refuses
  // an unversioned partial archive instead of pretending that discarded seeds are complete.
  if (!exists.rows[0]?.present) return undefined;
  const archive = resolveTableSql(db, DEAD_LETTER_SEED_TABLE);
  const ledger = resolveTableSql(db, 'computed_update_stage_ledger');
  const scopeId = task.ledgerScopeId ?? task.id;
  const membership = await sql<{ has_progress: boolean; captured: boolean }>`select
    exists(select 1 from ${ledger} where scope_id=${scopeId}) as has_progress,
    exists(select 1 from ${ledger} where scope_id=${scopeId} and kind='rerun-input-v1') as captured`.execute(
    db
  );
  for (const group of groups) {
    for (let offset = 0; offset < group.recordIds.length; offset += 1000) {
      const chunk = group.recordIds.slice(offset, offset + 1000);
      await sql`insert into ${archive}(task_id,table_id,record_id)
        select ${task.id}, ${group.tableId}, value from jsonb_array_elements_text(${JSON.stringify(chunk)}::jsonb)
        on conflict do nothing`.execute(db);
    }
  }
  await sql`insert into ${archive}(task_id,table_id,record_id)
    select ${task.id}, table_id, record_id from ${ledger}
    where scope_id=${scopeId} and kind in ('rerun-source','frontier','consumed','excluded')
    on conflict do nothing`.execute(db);
  const count = await sql<{
    count: string;
  }>`select count(*)::text as count from ${archive} where task_id=${task.id}`.execute(db);
  const state = membership.rows[0];
  return {
    version: 1,
    complete:
      membership.rows[0].captured ||
      (!state?.has_progress && !task.partialStageBudget && !task.seedAllCursors),
    seedCount: count.rows[0].count,
  };
};
