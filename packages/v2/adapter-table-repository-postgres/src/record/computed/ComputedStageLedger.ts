import { domainError, type DomainError } from '@teable/v2-core';
import { sql, type Kysely } from 'kysely';
import { err, ok, type Result } from 'neverthrow';
import type { DynamicDB } from '../query-builder';
import { CHANGE_FRONTIER_TABLE } from './ComputedChangeFrontier';

/**
 * Durable per-stage state for budget-staged computed updates, stored in
 * `computed_update_stage_ledger` and keyed by a ledger SCOPE — the id of the
 * continuation chain's root task. Chains are serial, so each scope has exactly
 * one writer at a time, and parallel chunk-split tasks of the same run never
 * share state. Rows are written once per record and shared by every
 * continuation of the chain instead of being copied between task payloads, so
 * both the payload size and the JS heap stay O(1) in the stage's total fan-out:
 * - kind 'excluded': targets already computed by earlier partial batches of the
 *   current run stage. Seeding and propagation anti-join this set directly.
 * - kind 'frontier': seq-ordered queue of sources whose outgoing propagation is
 *   not finished (self-referential generations and migrated explicit seeds).
 *   Each batch seeds only the queue head; settlement retires exactly the
 *   consumed head once its propagation completed.
 * - kind 'consumed': retired frontier sources preserved while the stage still
 *   has deferred edge chunks; the completed stage hands them to the deferred
 *   continuation as seeds so later chunks re-propagate from the same sources.
 */
export const STAGE_LEDGER_TABLE = 'computed_update_stage_ledger';

/**
 * How a stage settles its ledger lifecycle:
 * - 'stage-final': no deferred work follows — retired frontier rows delete, and
 *   collection covers only the stage's own outputs.
 * - 'carry-sources': deferred edge chunks follow — retired frontier rows become
 *   kind='consumed', and collection includes them so the continuation re-seeds
 *   the same sources. One value drives BOTH sides; passing them separately is
 *   how sources get lost.
 */
export type ComputedStageLedgerSettlementMode = 'stage-final' | 'carry-sources';

const DIRTY_TABLE = 'pg_temp.tmp_computed_dirty';

const infrastructureError = (message: string, error: unknown): DomainError =>
  domainError.infrastructure({
    message: `${message}: ${error instanceof Error ? error.message : String(error)}`,
  });

/** True when the scope still has queued frontier sources awaiting propagation. */
export const stageLedgerHasFrontier = async (
  db: Kysely<DynamicDB>,
  scopeId: string
): Promise<Result<boolean, DomainError>> => {
  try {
    const row = await db
      .selectFrom(STAGE_LEDGER_TABLE)
      .select(sql<number>`1`.as('one'))
      .where('scope_id', '=', scopeId)
      .where('kind', '=', 'frontier')
      .limit(1)
      .executeTakeFirst();
    return ok(row !== undefined);
  } catch (error) {
    return err(infrastructureError('Failed to probe stage ledger frontier', error));
  }
};

/**
 * Seed the frontier queue head into the dirty temp table, bounded by `limit`.
 * Returns the consumed row count, the highest seq consumed (for retirement) and
 * whether unseeded queue rows remain (a seeding truncation for the batch).
 */
export const seedStageLedgerFrontierHead = async (
  db: Kysely<DynamicDB>,
  scopeId: string,
  limit: number | undefined
): Promise<
  Result<{ consumed: number; maxSeq: string | null; remainder: boolean }, DomainError>
> => {
  try {
    const boundedLimit = limit === undefined ? undefined : Math.max(1, Math.trunc(limit));
    let head = db
      .selectFrom(STAGE_LEDGER_TABLE)
      .select(['table_id', 'record_id', 'seq'])
      .where('scope_id', '=', scopeId)
      .where('kind', '=', 'frontier')
      .orderBy('seq', 'asc')
      .orderBy('table_id', 'asc')
      .orderBy('record_id', 'asc');
    if (boundedLimit !== undefined) {
      head = head.limit(boundedLimit);
    }
    const inserted = await db.executeQuery(
      sql<{ consumed: string | number | bigint; max_seq: string | null }>`
        with head as materialized (${head}),
        ins as (
          insert into ${sql.table(DIRTY_TABLE)} (table_id, record_id)
          select table_id, record_id from head
          on conflict (table_id, record_id) do nothing
        )
        select count(*) as consumed, max(seq)::text as max_seq from head
      `.compile(db)
    );
    const row = inserted.rows[0];
    const consumed = Number(row?.consumed ?? 0);
    const maxSeq = row?.max_seq ?? null;
    if (boundedLimit === undefined || consumed < boundedLimit) {
      return ok({ consumed, maxSeq, remainder: false });
    }
    const rest = await db
      .selectFrom(STAGE_LEDGER_TABLE)
      .select(sql<number>`1`.as('one'))
      .where('scope_id', '=', scopeId)
      .where('kind', '=', 'frontier')
      .where('seq', '>', maxSeq === null ? 0 : sql<number>`${maxSeq}::bigint`)
      .limit(1)
      .executeTakeFirst();
    return ok({ consumed, maxSeq, remainder: rest !== undefined });
  } catch (error) {
    return err(infrastructureError('Failed to seed stage ledger frontier head', error));
  }
};

/**
 * Retire the consumed frontier head once its propagation completed untruncated.
 * When the stage still has deferred edge chunks that read from these sources
 * (preserveAsConsumed), the rows move to kind 'consumed' instead of being
 * deleted: the completed stage then hands them to the deferred continuation as
 * seeds, so later chunks can re-propagate from the same sources — retiring them
 * outright would silently drop every target only the later chunks reach.
 */
export const retireStageLedgerFrontierHead = async (
  db: Kysely<DynamicDB>,
  scopeId: string,
  maxSeqConsumed: string,
  options?: { preserveAsConsumed?: boolean }
): Promise<Result<number, DomainError>> => {
  try {
    if (options?.preserveAsConsumed) {
      await db.executeQuery(
        sql`
          insert into ${sql.table(STAGE_LEDGER_TABLE)} (scope_id, kind, table_id, record_id, seq)
          select scope_id, 'consumed', table_id, record_id, seq
          from ${sql.table(STAGE_LEDGER_TABLE)}
          where scope_id = ${scopeId} and kind = 'frontier'
            and seq <= ${maxSeqConsumed}::bigint
          on conflict (scope_id, kind, table_id, record_id) do nothing
        `.compile(db)
      );
    }
    // Retiring a queue head completes one batch, not the scope. Actual-value
    // evidence must survive subsequent batches and is cleared by clearStageLedger.
    const result = await db
      .deleteFrom(STAGE_LEDGER_TABLE)
      .where('scope_id', '=', scopeId)
      .where('kind', '=', 'frontier')
      .where('seq', '<=', sql<number>`${maxSeqConsumed}::bigint`)
      .executeTakeFirst();
    return ok(Number(result.numDeletedRows ?? 0));
  } catch (error) {
    return err(infrastructureError('Failed to retire stage ledger frontier head', error));
  }
};

/**
 * Push explicit seed groups onto the frontier queue HEAD (floor-entry seed
 * migration): they seed before older queue rows, preserving the pre-migration
 * ordering where explicit seeds were the batch's first sources.
 */
export const pushStageLedgerFrontierHead = async (
  db: Kysely<DynamicDB>,
  scopeId: string,
  groups: ReadonlyArray<{ tableId: string; recordIds: ReadonlyArray<string> }>
): Promise<Result<number, DomainError>> => {
  const rows = groups.flatMap((group) =>
    group.recordIds.map((recordId) => ({ tableId: group.tableId, recordId }))
  );
  if (rows.length === 0) return ok(0);
  try {
    // Fix the seq base once up front: batched inserts below must not shift it.
    const minRow = await db
      .selectFrom(STAGE_LEDGER_TABLE)
      .select(sql<string | null>`min(seq)::text`.as('min_seq'))
      .where('scope_id', '=', scopeId)
      .where('kind', '=', 'frontier')
      .executeTakeFirst();
    const base = BigInt(minRow?.min_seq ?? '0') - BigInt(rows.length);
    let pushed = 0;
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const values = sql.join(
        batch.map(
          (row, index) =>
            sql`(${scopeId}, 'frontier', ${row.tableId}, ${row.recordId}, ${(base + BigInt(i + index)).toString()}::bigint)`
        )
      );
      const result = await db.executeQuery(
        sql`
          insert into ${sql.table(STAGE_LEDGER_TABLE)} (scope_id, kind, table_id, record_id, seq)
          values ${values}
          on conflict (scope_id, kind, table_id, record_id) do nothing
        `.compile(db)
      );
      pushed += Number(result.numAffectedRows ?? 0);
    }
    return ok(pushed);
  } catch (error) {
    return err(infrastructureError('Failed to push stage ledger frontier head', error));
  }
};

/**
 * Fold a partial batch's outputs into the stage ledger, entirely SQL-side:
 * 1. (self-referential stages) append rows NEW this batch — dirty rows of the
 *    stage's step tables not yet excluded — to the frontier queue tail;
 * 2. add every dirty row of the stage's step tables to the exclusion ledger.
 * Order matters: the frontier append's anti-join against 'excluded' must see the
 * PRE-batch exclusion state, so it runs first.
 * Returns per-table processed counts for the continuation task's dirty stats.
 */
export const appendStageLedgerPartialBatch = async (
  db: Kysely<DynamicDB>,
  scopeId: string,
  stepTableIds: ReadonlyArray<string>,
  options: { appendFrontier: boolean }
): Promise<
  Result<
    {
      processedByTable: Array<{ tableId: string; recordCount: number }>;
      newFrontierRows: number;
      newExcludedRows: number;
    },
    DomainError
  >
> => {
  if (stepTableIds.length === 0) {
    return ok({ processedByTable: [], newFrontierRows: 0, newExcludedRows: 0 });
  }
  try {
    const tableFilter = sql.join(stepTableIds.map((tableId) => sql`${tableId}`));
    let newFrontierRows = 0;
    if (options.appendFrontier) {
      const frontier = await db.executeQuery(
        sql`
          insert into ${sql.table(STAGE_LEDGER_TABLE)} (scope_id, kind, table_id, record_id, seq)
          select ${scopeId}, 'frontier', d.table_id, d.record_id,
            coalesce((
              select max(seq) from ${sql.table(STAGE_LEDGER_TABLE)}
              where scope_id = ${scopeId} and kind = 'frontier'
            ), 0) + row_number() over (order by d.table_id, d.record_id)
          from ${sql.table(DIRTY_TABLE)} as d
          where d.table_id in (${tableFilter})
            and not exists (
              select 1 from ${sql.table(STAGE_LEDGER_TABLE)} as l
              where l.scope_id = ${scopeId} and l.kind = 'excluded'
                and l.table_id = d.table_id and l.record_id = d.record_id
            )
          on conflict (scope_id, kind, table_id, record_id) do nothing
        `.compile(db)
      );
      newFrontierRows = Number(frontier.numAffectedRows ?? 0);
    }
    const excluded = await db.executeQuery(
      sql`
        insert into ${sql.table(STAGE_LEDGER_TABLE)} (scope_id, kind, table_id, record_id)
        select ${scopeId}, 'excluded', d.table_id, d.record_id
        from ${sql.table(DIRTY_TABLE)} as d
        where d.table_id in (${tableFilter})
        on conflict (scope_id, kind, table_id, record_id) do nothing
      `.compile(db)
    );
    const processed = await db.executeQuery(
      sql<{ table_id: string; cnt: string | number | bigint }>`
        select table_id, count(*) as cnt from ${sql.table(DIRTY_TABLE)}
        where table_id in (${tableFilter})
        group by table_id
      `.compile(db)
    );
    return ok({
      processedByTable: processed.rows.map((row) => ({
        tableId: String(row.table_id),
        recordCount: Number(row.cnt),
      })),
      newFrontierRows,
      newExcludedRows: Number(excluded.numAffectedRows ?? 0),
    });
  } catch (error) {
    return err(infrastructureError('Failed to append stage ledger partial batch', error));
  }
};

/**
 * Collect a COMPLETED stage's dirty outputs — the union of the batch's dirty
 * temp table and the scope's exclusion ledger (rows processed by earlier
 * partial batches) — as next-stage seed groups, without ever materializing the
 * union anywhere: counting and id retrieval run directly over the two sources.
 * Tolerates a missing dirty temp table (a no-seed-input batch never creates
 * it) by collecting from the ledger alone.
 * Representation per table:
 * - count >= seedAllThreshold: whole-table seed (no ids fetched);
 * - otherwise exact ids, BUT the total ids fetched across all tables is capped
 *   by exactIdsTotalCap — tables are converted to whole-table seeds (largest
 *   dirty count first, where whole-table amplification is relatively smallest)
 *   until the remainder fits, so JS memory and payload stay hard-bounded no
 *   matter how many tables sit just under the threshold.
 */
export const collectStageOutputSeedGroups = async (
  db: Kysely<DynamicDB>,
  scopeId: string,
  tableIds: ReadonlyArray<string>,
  options: {
    seedAllThreshold: number;
    exactIdsTotalCap: number;
    /**
     * Include kind='consumed' rows (frontier sources whose propagation for THIS
     * stage's edges completed, preserved for deferred edge chunks). Set only
     * when the stage defers edges that must re-propagate from those sources.
     */
    includeConsumedSources?: boolean;
    /** Only completed stages may substitute proven actual output rows. */
    valueFrontierFields?: ReadonlyArray<{ tableId: string; fieldIds: ReadonlyArray<string> }>;
    allowConsumedPruning?: boolean;
  }
): Promise<
  Result<
    {
      groups: Array<{ tableId: string; recordIds: string[] }>;
      seedAllTableIds: string[];
      valuePrunedTableIds?: string[];
    },
    DomainError
  >
> => {
  if (tableIds.length === 0) return ok({ groups: [], seedAllTableIds: [] });
  try {
    // The dirty temp table only exists when the stage's batch actually executed:
    // a batch with no seed input (e.g. a continuation whose frontier fully
    // retired) skips execution entirely and never creates it, yet earlier
    // partial batches of the stage may still have outputs in the durable
    // ledger. Probe once and fall back to ledger-only collection — referencing
    // the relation unconditionally would fail parsing with 42P01.
    const dirtyProbe = await db.executeQuery(
      sql<{ dirty_table: string | null }>`
        select to_regclass(${DIRTY_TABLE}) as dirty_table
      `.compile(db)
    );
    const dirtyTableExists = dirtyProbe.rows[0]?.dirty_table != null;
    // Provably-disjoint branches instead of a deduplicating UNION: the ledger
    // branch anti-joins the dirty table, so no hash/sort dedup over the full
    // fan-out ever runs; each branch is a bounded scan / index probe. The
    // per-table predicate is pushed into BOTH branches on id retrieval.
    const antiJoinDirty = (alias: string) =>
      dirtyTableExists
        ? sql`
        and not exists (
          select 1 from ${sql.table(DIRTY_TABLE)} as d
          where d.table_id = ${sql.raw(alias)}.table_id and d.record_id = ${sql.raw(alias)}.record_id
        )
    `
        : sql``;
    const consumedBranch = (tableFilter: ReturnType<typeof sql.join>) =>
      options.includeConsumedSources
        ? sql`
      union all
      select c.table_id, c.record_id from ${sql.table(STAGE_LEDGER_TABLE)} as c
      where c.scope_id = ${scopeId} and c.kind = 'consumed' and c.table_id in (${tableFilter})
        ${antiJoinDirty('c')}
        and not exists (
          select 1 from ${sql.table(STAGE_LEDGER_TABLE)} as x
          where x.scope_id = ${scopeId} and x.kind = 'excluded'
            and x.table_id = c.table_id and x.record_id = c.record_id
        )
    `
        : sql``;
    const dirtyBranch = (tableFilter: ReturnType<typeof sql.join>) =>
      dirtyTableExists
        ? sql`
      select table_id, record_id from ${sql.table(DIRTY_TABLE)}
      where table_id in (${tableFilter})
      union all
    `
        : sql``;
    // Coverage is per output field, but the existing planner accepts table/row
    // seed groups. Unioning changed rows is conservative across sibling fields.
    const coveredTables: string[] = [];
    if (
      (!options.includeConsumedSources || options.allowConsumedPruning) &&
      options.valueFrontierFields?.length
    ) {
      for (const output of options.valueFrontierFields) {
        if (!output.fieldIds.length) continue;
        const fieldIds = [...new Set(output.fieldIds)];
        const evidence = await sql<{ covered: boolean }>`SELECT (
          NOT EXISTS (SELECT 1 FROM ${sql.table(CHANGE_FRONTIER_TABLE)}
            WHERE scope_id = ${scopeId} AND table_id = ${output.tableId} AND kind = 'fallback')
          AND (SELECT count(*) FROM ${sql.table(CHANGE_FRONTIER_TABLE)}
            WHERE scope_id = ${scopeId} AND table_id = ${output.tableId}
              AND kind = 'covered' AND field_id IN (${sql.join(fieldIds)})) = ${fieldIds.length}
          AND NOT EXISTS (
            SELECT 1 FROM ${sql.table(STAGE_LEDGER_TABLE)} p
            WHERE p.scope_id = ${scopeId} AND p.table_id = ${output.tableId} AND p.kind IN ('excluded', 'consumed')
              AND NOT EXISTS (SELECT 1 FROM ${sql.table(CHANGE_FRONTIER_TABLE)} c
                WHERE c.scope_id = ${scopeId} AND c.table_id = p.table_id
                  AND c.record_id = p.record_id AND c.kind = 'processed')
          )
          ${
            dirtyTableExists
              ? sql`AND NOT EXISTS (
            SELECT 1 FROM ${sql.table(DIRTY_TABLE)} p WHERE p.table_id = ${output.tableId}
              AND NOT EXISTS (SELECT 1 FROM ${sql.table(CHANGE_FRONTIER_TABLE)} c
                WHERE c.scope_id = ${scopeId} AND c.table_id = p.table_id
                  AND c.record_id = p.record_id AND c.kind = 'processed')
          )`
              : sql``
          }
        ) AS covered`.execute(db);
        if (evidence.rows[0]?.covered) coveredTables.push(output.tableId);
      }
    }
    const originalSource = (tableFilter: ReturnType<typeof sql.join>) => sql`
      ${dirtyBranch(tableFilter)}
      select l.table_id, l.record_id from ${sql.table(STAGE_LEDGER_TABLE)} as l
      where l.scope_id = ${scopeId} and l.kind = 'excluded' and l.table_id in (${tableFilter})
        ${antiJoinDirty('l')}
      ${consumedBranch(tableFilter)}
    `;
    const requestedFields =
      options.valueFrontierFields?.flatMap((output) => [...output.fieldIds]) ?? [];
    const disjointSource = (tableFilter: ReturnType<typeof sql.join>) =>
      coveredTables.length
        ? sql`
          SELECT candidates.table_id, candidates.record_id FROM (${originalSource(tableFilter)}) candidates
          WHERE candidates.table_id NOT IN (${sql.join(coveredTables)})
          UNION ALL
          SELECT table_id, record_id FROM ${sql.table(CHANGE_FRONTIER_TABLE)}
          WHERE scope_id = ${scopeId} AND kind = 'changed'
            AND table_id IN (${tableFilter}) AND table_id IN (${sql.join(coveredTables)})
            AND field_id IN (${sql.join(requestedFields)})
          GROUP BY table_id, record_id
        `
        : originalSource(tableFilter);
    const allTablesFilter = sql.join(tableIds.map((tableId) => sql`${tableId}`));
    const counts = await db.executeQuery(
      sql<{ table_id: string; cnt: string | number | bigint }>`
        select table_id, count(*) as cnt from (${disjointSource(allTablesFilter)}) as stage_output
        group by table_id
      `.compile(db)
    );
    const tables = counts.rows
      .map((row) => ({ tableId: String(row.table_id), count: Number(row.cnt) }))
      .filter((table) => table.count > 0);

    const seedAllTableIds = tables
      .filter((table) => table.count >= options.seedAllThreshold)
      .map((table) => table.tableId);
    // Ascending count keeps the most tables in exact-id form under the cap;
    // the largest under-threshold tables convert to whole-table seeds first.
    const exactCandidates = tables
      .filter((table) => table.count < options.seedAllThreshold)
      .sort((left, right) => left.count - right.count);
    const groups: Array<{ tableId: string; recordIds: string[] }> = [];
    let fetchedTotal = 0;
    for (const table of exactCandidates) {
      if (fetchedTotal + table.count > options.exactIdsTotalCap) {
        seedAllTableIds.push(table.tableId);
        continue;
      }
      const ids = await db.executeQuery(
        sql<{ record_id: string }>`
          select record_id from (${disjointSource(sql.join([sql`${table.tableId}`]))}) as stage_output
        `.compile(db)
      );
      const recordIds = ids.rows.map((row) => String(row.record_id));
      if (recordIds.length === 0) continue;
      fetchedTotal += recordIds.length;
      groups.push({ tableId: table.tableId, recordIds });
    }
    return ok({
      groups,
      seedAllTableIds,
      ...(coveredTables.length ? { valuePrunedTableIds: coveredTables } : {}),
    });
  } catch (error) {
    return err(infrastructureError('Failed to collect stage output seed groups', error));
  }
};

/** Drop all ledger state for a scope (stage completion or chain dead-letter). */
export const clearStageLedger = async (
  db: Kysely<DynamicDB>,
  scopeId: string
): Promise<Result<number, DomainError>> => {
  try {
    await db.deleteFrom(CHANGE_FRONTIER_TABLE).where('scope_id', '=', scopeId).execute();
    const result = await db
      .deleteFrom(STAGE_LEDGER_TABLE)
      .where('scope_id', '=', scopeId)
      .executeTakeFirst();
    return ok(Number(result.numDeletedRows ?? 0));
  } catch (error) {
    return err(infrastructureError('Failed to clear stage ledger', error));
  }
};
