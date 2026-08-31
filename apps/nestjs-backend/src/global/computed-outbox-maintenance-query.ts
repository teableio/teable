import { normalizeComputedOutboxErrorSignature } from '@teable/v2-core';

export type ComputedOutboxWakeupCandidateQueryTarget = {
  storage: 'default' | 'byodb';
  internalSchema?: string;
  baseSpaceMapping?: ReadonlyArray<{ baseId: string; spaceId: string }>;
};

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

export const qualifyComputedOutboxTable = (
  target: ComputedOutboxWakeupCandidateQueryTarget,
  table: string
) =>
  target.internalSchema
    ? `${quoteIdentifier(target.internalSchema)}.${quoteIdentifier(table)}`
    : quoteIdentifier(table);

/**
 * Join used to evaluate space-scoped pauses. Default storage reads `base`
 * locally; BYODB targets pass the meta mapping as JSON because `base` is not
 * in the tenant data database.
 */
const buildComputedOutboxPauseSpaceJoin = (
  target: ComputedOutboxWakeupCandidateQueryTarget
): { sql: string; bindings: unknown[] } => {
  if (target.storage === 'default') {
    return { sql: 'left join "base" as cb on cb."id" = o.base_id', bindings: [] };
  }
  return {
    sql: `left join jsonb_to_recordset(?::jsonb) as cb(base_id text, space_id text)
            on cb.base_id = o.base_id`,
    bindings: [
      JSON.stringify(
        (target.baseSpaceMapping ?? []).map(({ baseId, spaceId }) => ({
          base_id: baseId,
          space_id: spaceId,
        }))
      ),
    ],
  };
};

/**
 * Admin monitoring fans this query to every ready data-db. It must schema-
 * qualify like inspect/wakeup: BYODB tables live in `internalSchema`, and
 * connection-string `search_path` is not reliable through poolers.
 */
export const buildComputedOutboxTaskStatesQuery = (
  target: ComputedOutboxWakeupCandidateQueryTarget,
  taskIds: ReadonlyArray<string>
): { sql: string; bindings: unknown[] } => {
  const ids = [...taskIds];
  const deadLetterTable = qualifyComputedOutboxTable(target, 'computed_update_dead_letter');
  const outboxTable = qualifyComputedOutboxTable(target, 'computed_update_outbox');
  return {
    sql: `select id as "taskId", 'dead'::text as state
           from ${deadLetterTable}
           where id = any(?::text[])
           union all
           select id as "taskId",
             case when status = 'processing' then 'processing' else 'pending' end as state
           from ${outboxTable}
           where id = any(?::text[])`,
    bindings: [ids, ids],
  };
};

export const buildComputedOutboxAnomalyListQuery = (
  target: ComputedOutboxWakeupCandidateQueryTarget,
  processingLeaseMs: number,
  limit: number
): { sql: string; bindings: unknown[] } => {
  const routedFilter = buildComputedOutboxRoutedFilter(target);
  const pauseJoin = buildComputedOutboxPauseSpaceJoin(target);
  const deadLetterTable = qualifyComputedOutboxTable(target, 'computed_update_dead_letter');
  const outboxTable = qualifyComputedOutboxTable(target, 'computed_update_outbox');
  const pauseScopeTable = qualifyComputedOutboxTable(target, 'computed_update_pause_scope');
  const normalizedLimit = Math.max(1, Math.min(2000, Math.trunc(limit)));
  return {
    sql: `with ${routedFilter.cte},
          anomalies as (
            select
              'dead'::text as kind,
              id as "taskId",
              base_id as "baseId",
              seed_table_id as "seedTableId",
              attempts,
              max_attempts as "maxAttempts",
              left(last_error, 2000) as "lastError",
              left(trace_data #>> '{execution,statement,normalizedSql}', 4000) as "failedSql",
              left(trace_data #>> '{failure,kind}', 128) as "failureKind",
              left(trace_data #>> '{failure,phase}', 128) as "failurePhase",
              left(trace_data #>> '{execution,context,tableName}', 256) as "affectedTableName",
              failed_at as "occurredAt"
            from ${deadLetterTable}
            where ${routedFilter.condition('base_id')}
            union all
            select
              'stale'::text as kind,
              o.id as "taskId",
              o.base_id as "baseId",
              o.seed_table_id as "seedTableId",
              o.attempts,
              o.max_attempts as "maxAttempts",
              left(o.last_error, 2000) as "lastError",
              null::text as "failedSql",
              null::text as "failureKind",
              null::text as "failurePhase",
              null::text as "affectedTableName",
              coalesce(o.locked_at, o.updated_at) as "occurredAt"
            from ${outboxTable} as o
            ${pauseJoin.sql}
            where o.status = 'processing'
              and (o.locked_at is null or o.locked_at <= now() - (? * interval '1 millisecond'))
              and ${routedFilter.condition('o.base_id')}
              and not exists (
                select 1
                from ${pauseScopeTable} as cps
                where (cps.resume_at is null or cps.resume_at > now())
                  and (
                    (cps.scope_type = 'base' and cps.scope_id = o.base_id)
                    or (
                      cps.scope_type = 'table'
                      and (
                        cps.scope_id = o.seed_table_id
                        or cps.scope_id = any(coalesce(o.affected_table_ids, ARRAY[]::text[]))
                      )
                    )
                    or (cps.scope_type = 'space' and cps.scope_id = cb.space_id)
                  )
              )
          )
          select *, count(*) over () as total
          from anomalies
          order by "occurredAt" desc, "taskId" asc
          limit ?`,
    bindings: [...routedFilter.bindings, ...pauseJoin.bindings, processingLeaseMs, normalizedLimit],
  };
};

export const buildComputedOutboxStaleRecoverySelectQuery = (
  target: ComputedOutboxWakeupCandidateQueryTarget,
  taskId: string,
  processingLeaseMs: number
): { sql: string; bindings: unknown[] } => {
  const pauseJoin = buildComputedOutboxPauseSpaceJoin(target);
  const outboxTable = qualifyComputedOutboxTable(target, 'computed_update_outbox');
  const pauseScopeTable = qualifyComputedOutboxTable(target, 'computed_update_pause_scope');
  return {
    sql: `select o.base_id as "baseId"
             from ${outboxTable} as o
             ${pauseJoin.sql}
             where o.id = ?
               and o.status = 'processing'
               and (o.locked_at is null or o.locked_at <= now() - (? * interval '1 millisecond'))
               and not exists (
                 select 1
                 from ${pauseScopeTable} as cps
                 where (cps.resume_at is null or cps.resume_at > now())
                   and (
                     (cps.scope_type = 'base' and cps.scope_id = o.base_id)
                     or (
                       cps.scope_type = 'table'
                       and (
                         cps.scope_id = o.seed_table_id
                         or cps.scope_id = any(coalesce(o.affected_table_ids, ARRAY[]::text[]))
                       )
                     )
                     or (cps.scope_type = 'space' and cps.scope_id = cb.space_id)
                   )
               )
             limit 1`,
    bindings: [...pauseJoin.bindings, taskId, processingLeaseMs],
  };
};

export type ComputedOutboxWakeupCandidateQueryOptions = {
  /** Limit reconciliation to work that can be claimed now. */
  actionableOnly?: boolean;
};

export const buildComputedOutboxActivePauseExclusion = (
  target: ComputedOutboxWakeupCandidateQueryTarget
): { sql: string; bindings: unknown[] } => {
  const pauseSpaceJoin = buildComputedOutboxPauseSpaceJoin(target);
  const pauseScopeTable = qualifyComputedOutboxTable(target, 'computed_update_pause_scope');
  return {
    sql: `not exists (
      select 1
      from ${pauseScopeTable} as cps
      ${pauseSpaceJoin.sql}
      where (cps.resume_at is null or cps.resume_at > now())
        and (
          (cps.scope_type = 'base' and cps.scope_id = o.base_id)
          or (
            cps.scope_type = 'table'
            and (
              cps.scope_id = o.seed_table_id
              or cps.scope_id = any(coalesce(o.affected_table_ids, ARRAY[]::text[]))
            )
          )
          or (cps.scope_type = 'space' and cps.scope_id = cb.space_id)
        )
    )`,
    bindings: pauseSpaceJoin.bindings,
  };
};

/**
 * Must stay equivalent to normalizeComputedOutboxErrorSignature.
 * Digit runs are collapsed so volatile numeric identifiers do not split one
 * root cause into hundreds of single-task groups.
 */
export const COMPUTED_OUTBOX_ERROR_SIGNATURE_SQL =
  "regexp_replace(left(coalesce(last_error, ''), 500), '[0-9]+', '#', 'g')";

/**
 * Ledger entries whose base no longer routes to this storage target are
 * orphans: replaying them would run computations against a database that is no
 * longer authoritative for that base (e.g. after a BYODB migration, or once the
 * base is deleted). Both the anomaly list and the monitoring counts must apply
 * this filter so the admin badge and the list report the same population.
 */
export const buildComputedOutboxRoutedFilter = (
  target: ComputedOutboxWakeupCandidateQueryTarget
): { cte: string; condition: (column: string) => string; bindings: unknown[] } => {
  if (target.storage === 'byodb') {
    const baseSpaceMapping = target.baseSpaceMapping ?? [];
    return {
      cte: `routable as (
          select rb.base_id
          from jsonb_to_recordset(?::jsonb) as rb(base_id text, space_id text)
        )`,
      condition: (column: string) => `${column} in (select base_id from routable)`,
      bindings: [
        JSON.stringify(
          baseSpaceMapping.map(({ baseId, spaceId }) => ({
            base_id: baseId,
            space_id: spaceId,
          }))
        ),
      ],
    };
  }
  return {
    cte: `routed_away as (
        select bb."id" as base_id
        from space_data_db_binding as sdb
        join data_db_connection as dc
          on dc."id" = sdb.data_db_connection_id and dc.status = 'ready'
        join "base" as bb on bb.space_id = sdb.space_id
        where sdb.mode = 'byodb' and sdb.state = 'ready'
      )`,
    condition: (column: string) => `${column} not in (select base_id from routed_away)`,
    bindings: [],
  };
};

/**
 * The default storage claims tasks with the shared (meta) database as its data
 * plane. A space bound to an external data database only has an orphaned
 * pre-switch copy there, so its tasks must never be redriven on this storage —
 * the claim side fences them out and publishing wakeups for them only churns.
 */
export const buildComputedOutboxForeignBindingExclusion = (
  target: ComputedOutboxWakeupCandidateQueryTarget
): string =>
  target.storage === 'default'
    ? `and not exists (
        select 1
        from "base" as fbb
        join "space_data_db_binding" as sdb on sdb."space_id" = fbb."space_id"
        where fbb."id" = o.base_id
          and sdb."mode" <> 'default'
      )`
    : '';

/**
 * Pull orphaned pause-deferred rows back to due. pauseScope batch-rewrites the
 * next_run_at of every matching due pending task to the lease's resumeAt (up to
 * 2h out); restore relies on the pausing scope's own resume/release firing with
 * a matching scope condition. A row deferred by one scope but restored by none
 * ends up future-dated with no active pause covering it — a state no other
 * mechanism produces (failure backoff caps at 5min), invisible to the claim
 * scan and the redrive sweep alike (both key on next_run_at <= now()), so the
 * cascade silently never finishes (T6648). The threshold keeps legitimate
 * failure-backoff schedules out of scope.
 */
export const buildComputedOutboxOrphanedDeferralRestoreQuery = (
  target: ComputedOutboxWakeupCandidateQueryTarget,
  orphanedDeferralThresholdMs: number
): { sql: string; bindings: unknown[] } => {
  const pauseExclusion = buildComputedOutboxActivePauseExclusion(target);
  const foreignBindingExclusion = buildComputedOutboxForeignBindingExclusion(target);
  const outboxTable = qualifyComputedOutboxTable(target, 'computed_update_outbox');
  return {
    sql: `update ${outboxTable} as o
      set next_run_at = now(), updated_at = now()
      where o.status = 'pending'
        and o.next_run_at > now() + (? * interval '1 millisecond')
        and ${pauseExclusion.sql}
        ${foreignBindingExclusion}`,
    bindings: [orphanedDeferralThresholdMs, ...pauseExclusion.bindings],
  };
};

export const buildComputedOutboxWakeupCandidatesQuery = (
  target: ComputedOutboxWakeupCandidateQueryTarget,
  processingLeaseMs: number,
  batchSize: number,
  afterId?: string,
  options: ComputedOutboxWakeupCandidateQueryOptions = {}
): { sql: string; bindings: unknown[] } => {
  const pauseExclusion = buildComputedOutboxActivePauseExclusion(target);
  const foreignBindingExclusion = buildComputedOutboxForeignBindingExclusion(target);
  const outboxTable = qualifyComputedOutboxTable(target, 'computed_update_outbox');
  const bindings: unknown[] = [...pauseExclusion.bindings];
  const actionableClause = options.actionableOnly
    ? `and (
        (o.status = 'pending' and o.next_run_at <= now())
        or (
          o.status = 'processing'
          and (o.locked_at is null or o.locked_at <= now() - (? * interval '1 millisecond'))
        )
      )`
    : '';
  if (options.actionableOnly) bindings.push(processingLeaseMs);
  const afterClause = afterId ? 'and o.id > ?' : '';
  if (afterId) bindings.push(afterId);
  bindings.push(Math.max(1, Math.trunc(batchSize)));

  return {
    sql: `select
        o.id as "taskId",
        o.base_id as "baseId",
        o.status,
        o.next_run_at as "nextRunAt",
        o.locked_at as "lockedAt",
        o.attempts,
        o.updated_at as "updatedAt"
      from ${outboxTable} as o
      where o.status in ('pending', 'processing')
        and ${pauseExclusion.sql}
        ${foreignBindingExclusion}
        ${actionableClause}
        ${afterClause}
      order by o.id asc
      limit ?`,
    bindings,
  };
};

export type ComputedOutboxDeadLetterBatchSelection = {
  baseId: string;
  seedTableId: string;
  errorSignature: string;
};

export { normalizeComputedOutboxErrorSignature };

export const buildComputedOutboxDeadLetterBatchSelectionQuery = (
  target: ComputedOutboxWakeupCandidateQueryTarget,
  selection: ComputedOutboxDeadLetterBatchSelection
): { sql: string; bindings: unknown[] } => ({
  // Lock and order the whole group by ids only. Full payloads (steps/edges JSONB can be
  // large) are fetched per insert chunk so peak memory is bounded by the chunk size,
  // not the group size.
  sql: `select id as "taskId"
    from ${qualifyComputedOutboxTable(target, 'computed_update_dead_letter')}
    where base_id = ?
      and seed_table_id = ?
      and ${COMPUTED_OUTBOX_ERROR_SIGNATURE_SQL} = ?
    order by failed_at asc, id asc
    for update`,
  bindings: [
    selection.baseId,
    selection.seedTableId,
    normalizeComputedOutboxErrorSignature(selection.errorSignature),
  ],
});

/**
 * Normalized lineage projection over the three computed-update ledgers (T6908):
 * live outbox rows, dead letters, and the run-history completion ledger. Every
 * arm emits the same column list so lookups and run-chain scans can UNION them.
 */
const buildComputedOutboxLineageLedgerSelect = (
  target: ComputedOutboxWakeupCandidateQueryTarget,
  table: 'computed_update_outbox' | 'computed_update_dead_letter',
  whereSql: string
): string => {
  const isDead = table === 'computed_update_dead_letter';
  const qualified = qualifyComputedOutboxTable(target, table);
  const seedTable = qualifyComputedOutboxTable(target, 'computed_update_outbox_seed');
  const inlineSeedCount = `(case
      when jsonb_typeof(t.seed_record_ids) = 'array' then (
        select coalesce(sum(jsonb_array_length(g->'recordIds')), 0)::int
        from jsonb_array_elements(t.seed_record_ids) as g
      )
      else 0
    end)`;
  const seedRecordCount = isDead
    ? inlineSeedCount
    : `${inlineSeedCount} + (select count(*)::int from ${seedTable} as s where s.task_id = t.id)`;
  return `select
      '${isDead ? 'dead' : 'live'}'::text as "source",
      t.id as "taskId",
      t.base_id as "baseId",
      t.seed_table_id as "seedTableId",
      t.change_type as "changeType",
      t.run_id as "runId",
      t.origin_run_ids as "originRunIds",
      ${isDead ? `'dead'::text` : 't.status'} as "status",
      coalesce(t.stage_depth, 0) as "stageDepth",
      t.predecessor_task_id as "predecessorTaskId",
      t.attempts,
      t.estimated_complexity as "estimatedComplexity",
      t.run_total_steps as "runTotalSteps",
      t.run_completed_steps_before as "runCompletedStepsBefore",
      t.sync_max_level as "syncMaxLevel",
      case
        when jsonb_typeof(t.dirty_stats) = 'object'
         and jsonb_typeof(t.dirty_stats->'sourceFieldIds') = 'array'
        then coalesce((
          select array_agg(elem)
          from jsonb_array_elements_text(t.dirty_stats->'sourceFieldIds') as e(elem)
        ), '{}'::text[])
        else '{}'::text[]
      end as "sourceFieldIds",
      ${seedRecordCount} as "seedRecordCount",
      t.affected_table_ids as "affectedTableIds",
      t.affected_field_ids as "affectedFieldIds",
      t.source_changed_at as "sourceChangedAt",
      t.created_at as "enqueuedAt",
      t.locked_at as "startedAt",
      null::timestamptz as "completedAt",
      ${isDead ? 't.failed_at' : 'null::timestamptz'} as "failedAt",
      null::int as "durationMs",
      left(t.last_error, 2000) as "lastError",
      t.steps,
      t.edges
    from ${qualified} as t
    where ${whereSql}`;
};

const buildComputedOutboxLineageHistorySelect = (
  target: ComputedOutboxWakeupCandidateQueryTarget,
  whereSql: string
): string => {
  const qualified = qualifyComputedOutboxTable(target, 'computed_update_run_history');
  return `select
      'history'::text as "source",
      t.task_id as "taskId",
      t.base_id as "baseId",
      t.seed_table_id as "seedTableId",
      t.change_type as "changeType",
      t.run_id as "runId",
      t.origin_run_ids as "originRunIds",
      'succeeded'::text as "status",
      coalesce(t.stage_depth, 0) as "stageDepth",
      t.predecessor_task_id as "predecessorTaskId",
      t.attempts,
      t.estimated_complexity as "estimatedComplexity",
      t.run_total_steps as "runTotalSteps",
      t.run_completed_steps_before as "runCompletedStepsBefore",
      t.sync_max_level as "syncMaxLevel",
      t.source_field_ids as "sourceFieldIds",
      t.seed_record_count as "seedRecordCount",
      t.affected_table_ids as "affectedTableIds",
      t.affected_field_ids as "affectedFieldIds",
      t.source_changed_at as "sourceChangedAt",
      t.enqueued_at as "enqueuedAt",
      t.started_at as "startedAt",
      t.completed_at as "completedAt",
      null::timestamptz as "failedAt",
      t.duration_ms as "durationMs",
      null::text as "lastError",
      t.steps,
      t.edges
    from ${qualified} as t
    where ${whereSql}`;
};

export const buildComputedOutboxRunHistoryExistsQuery = (
  target: ComputedOutboxWakeupCandidateQueryTarget
): { sql: string; bindings: unknown[] } => ({
  sql: `select to_regclass(?) is not null as "exists"`,
  bindings: [
    target.internalSchema
      ? `${target.internalSchema}.computed_update_run_history`
      : 'computed_update_run_history',
  ],
});

export const buildComputedOutboxLineageTaskLookupQuery = (
  target: ComputedOutboxWakeupCandidateQueryTarget,
  taskId: string,
  includeHistory: boolean
): { sql: string; bindings: unknown[] } => {
  const arms = [
    buildComputedOutboxLineageLedgerSelect(target, 'computed_update_outbox', 't.id = ?'),
    buildComputedOutboxLineageLedgerSelect(target, 'computed_update_dead_letter', 't.id = ?'),
    ...(includeHistory ? [buildComputedOutboxLineageHistorySelect(target, 't.task_id = ?')] : []),
  ];
  return {
    sql: arms.join('\nunion all\n'),
    bindings: arms.map(() => taskId),
  };
};

export const buildComputedOutboxLineageRunChainQuery = (
  target: ComputedOutboxWakeupCandidateQueryTarget,
  runIds: ReadonlyArray<string>,
  includeHistory: boolean,
  limit: number
): { sql: string; bindings: unknown[] } => {
  const chainWhere = `(t.run_id = any(?::text[]) or t.origin_run_ids && ?::text[])`;
  const arms = [
    buildComputedOutboxLineageLedgerSelect(target, 'computed_update_outbox', chainWhere),
    buildComputedOutboxLineageLedgerSelect(target, 'computed_update_dead_letter', chainWhere),
    ...(includeHistory ? [buildComputedOutboxLineageHistorySelect(target, chainWhere)] : []),
  ];
  const ids = [...runIds];
  return {
    sql: `select * from (\n${arms.join('\nunion all\n')}\n) as chain
      order by "runCompletedStepsBefore" asc, "stageDepth" asc, "enqueuedAt" asc
      limit ?`,
    bindings: [...arms.flatMap(() => [ids, ids]), Math.max(1, Math.min(500, Math.trunc(limit)))],
  };
};

const NO_MERGE_PLAN_HASH_MARKER = ':nolock:';

/** Keep every recovered task independently durable; worker admission controls execution. */
export const buildComputedOutboxRecoveryPlanHash = (planHash: string, taskId: string): string => {
  const base = planHash.split(NO_MERGE_PLAN_HASH_MARKER)[0];
  return `${base}${NO_MERGE_PLAN_HASH_MARKER}replay_${taskId}`;
};
