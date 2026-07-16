export type ComputedOutboxWakeupCandidateQueryTarget = {
  storage: 'default' | 'byodb';
  baseSpaceMapping?: ReadonlyArray<{ baseId: string; spaceId: string }>;
};

export type ComputedOutboxWakeupCandidateQueryOptions = {
  /** Limit reconciliation to work that can be claimed now. */
  actionableOnly?: boolean;
};

export const buildComputedOutboxActivePauseExclusion = (
  target: ComputedOutboxWakeupCandidateQueryTarget
): { sql: string; bindings: unknown[] } => {
  const baseSpaceMapping = target.baseSpaceMapping ?? [];
  const pauseSpaceJoin =
    target.storage === 'default'
      ? 'left join "base" as cb on cb."id" = o.base_id'
      : `left join jsonb_to_recordset(?::jsonb) as cb(base_id text, space_id text)
          on cb.base_id = o.base_id`;
  const bindings =
    target.storage === 'byodb'
      ? [
          JSON.stringify(
            baseSpaceMapping.map(({ baseId, spaceId }) => ({
              base_id: baseId,
              space_id: spaceId,
            }))
          ),
        ]
      : [];
  return {
    sql: `not exists (
      select 1
      from computed_update_pause_scope as cps
      ${pauseSpaceJoin}
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
    bindings,
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
      from computed_update_outbox as o
      where o.status in ('pending', 'processing')
        and ${pauseExclusion.sql}
        ${actionableClause}
        ${afterClause}
      order by o.id asc
      limit ?`,
    bindings,
  };
};
