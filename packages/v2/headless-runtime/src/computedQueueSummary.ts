import { sql, type Kysely } from 'kysely';

/**
 * Single-owner view of the computed queue, for the runtime flush report.
 *
 * Buckets are disjoint per row, so `pending` is their sum plus due work:
 * - `pending`     every live outbox row (`status in ('pending','processing')`);
 *                 it is a total, not an additional bucket.
 * - `processing`  live row already claimed by a worker (`status = 'processing'`).
 * - `paused`      live row matched by an effective pause scope (`resume_at` null
 *                 or in the future), for its base, seed/affected table or space.
 * - `scheduled`   live row that is not paused and is not due yet
 *                 (`next_run_at > now`).
 * - `deadLetter`  rows in the dead-letter table; separate storage, never part of
 *                 `pending`.
 *
 * The remainder (`pending - processing - paused - scheduled`) is due, unpaused,
 * unclaimed work. That count is deliberately not a claim promise: it ignores
 * claim concurrency caps and worker lanes, so `pending > 0` never means the
 * queue is idle and `scheduled`/`paused` never hide behind it.
 */
export interface IComputedQueueSummary {
  pending: number;
  scheduled: number;
  processing: number;
  paused: number;
  deadLetter: number;
  /** Earliest `next_run_at` among pending, unpaused rows; null when none exist. */
  nextRunAt: Date | null;
}

/** Public name for the flush report field. */
export type ComputedQueueSummary = IComputedQueueSummary;

export interface IComputedQueueSummaryOptions {
  /** Data schema when the Kysely handle is not already schema-bound. */
  schema?: string;
  /**
   * Whether `base.space_id` is in the same physical database. Split meta/data
   * deployments cannot resolve space pause scopes from the data DB.
   */
  spacePauseResolvable?: boolean;
}

export class ComputedQueueSummaryUnavailableError extends Error {
  readonly code = 'computed.summary_unavailable';

  constructor(message: string) {
    super(message);
    this.name = 'ComputedQueueSummaryUnavailableError';
  }
}

/** Column contract: adapter-repository `src/db/schema.ts` — outbox :323, pause :419, dead letter :434. */
const OUTBOX_TABLE = 'computed_update_outbox';
const PAUSE_SCOPE_TABLE = 'computed_update_pause_scope';
const DEAD_LETTER_TABLE = 'computed_update_dead_letter';
const tableRef = (schema: string | undefined, name: string) =>
  schema ? sql`${sql.id(schema)}.${sql.id(name)}` : sql.table(name);

const isMissingRelationError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '42P01';

type SummaryRow = {
  pending: number;
  scheduled: number;
  processing: number;
  paused: number;
  deadLetter: number;
  nextRunAt: Date | string | null;
};

/**
 * Reads the queue without claiming, pausing or writing anything. The pause
 * predicate mirrors `buildComputedTaskNotPausedCondition`
 * (`computed/pause/ComputedUpdatePauseRegistry.ts:780-817`), and the live-status
 * filter mirrors the claim probe (`computed/outbox/ComputedUpdateOutbox.ts:1623-1645`).
 */
export const readComputedQueueSummary = async (
  db: Kysely<unknown>,
  now: Date = new Date(),
  options: IComputedQueueSummaryOptions = {}
): Promise<ComputedQueueSummary> => {
  const { schema, spacePauseResolvable = true } = options;
  const outbox = tableRef(schema, OUTBOX_TABLE);
  const pauses = tableRef(schema, PAUSE_SCOPE_TABLE);
  const deadLetters = tableRef(schema, DEAD_LETTER_TABLE);
  const base = tableRef(undefined, 'base');
  const spacePausePredicate = spacePauseResolvable
    ? sql`or (
        ${sql.ref('cps.scope_type')} = 'space'
        and ${sql.ref('cps.scope_id')} = ${sql.ref('cb.space_id')}
      )`
    : sql``;
  const baseJoin = spacePauseResolvable
    ? sql`left join ${base} cb on ${sql.ref('cb.id')} = ${sql.ref('o.base_id')}`
    : sql``;
  let result;
  try {
    result = await sql<SummaryRow>`
      with live as (
        select
          ${sql.ref('o.status')} as status,
          ${sql.ref('o.next_run_at')} as next_run_at,
          exists (
            select 1
            from ${pauses} cps
            ${baseJoin}
            where (${sql.ref('cps.resume_at')} is null or ${sql.ref('cps.resume_at')} > ${now})
              and (
                (${sql.ref('cps.scope_type')} = 'base' and ${sql.ref('cps.scope_id')} = ${sql.ref('o.base_id')})
                or (
                  ${sql.ref('cps.scope_type')} = 'table'
                  and (
                    ${sql.ref('cps.scope_id')} = ${sql.ref('o.seed_table_id')}
                    or ${sql.ref('cps.scope_id')} = any(
                      coalesce(${sql.ref('o.affected_table_ids')}, array[]::text[])
                    )
                  )
                )
                ${spacePausePredicate}
              )
          ) as paused
        from ${outbox} o
        where ${sql.ref('o.status')} in ('pending', 'processing')
      )
      select
        count(*)::int as pending,
        count(*) filter (where status = 'processing')::int as processing,
        count(*) filter (where status = 'pending' and paused)::int as paused,
        count(*) filter (where status = 'pending' and not paused and next_run_at > ${now})::int
          as scheduled,
        min(next_run_at) filter (where status = 'pending' and not paused) as "nextRunAt",
        (select count(*) from ${deadLetters})::int as "deadLetter"
      from live
    `.execute(db);
  } catch (error) {
    if (isMissingRelationError(error)) {
      throw new ComputedQueueSummaryUnavailableError('Computed queue tables are not provisioned');
    }
    throw error;
  }

  if (!spacePauseResolvable) {
    const activeSpacePauses = await sql<{ count: number }>`
      select count(*)::int as count
      from ${pauses}
      where ${sql.ref('scope_type')} = 'space'
        and (${sql.ref('resume_at')} is null or ${sql.ref('resume_at')} > ${now})
    `.execute(db);
    if ((activeSpacePauses.rows[0]?.count ?? 0) > 0) {
      throw new ComputedQueueSummaryUnavailableError(
        'Space pause scopes require meta and data in the same database'
      );
    }
  }

  const row = result.rows[0];
  if (!row) {
    throw new ComputedQueueSummaryUnavailableError('Computed queue summary returned no row');
  }

  return {
    pending: row.pending,
    scheduled: row.scheduled,
    processing: row.processing,
    paused: row.paused,
    deadLetter: row.deadLetter,
    nextRunAt: row.nextRunAt === null ? null : new Date(row.nextRunAt),
  };
};
