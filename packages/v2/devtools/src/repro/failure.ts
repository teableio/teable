import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export type ReproSqlExecution = {
  sqlState?: string;
  severity?: string;
  position?: number;
  routine?: string;
  table?: string;
  column?: string;
  dataType?: string;
  constraint?: string;
};

export type ReproFailureReport = {
  kind: 'dead_letter' | 'queue_leftover' | 'none';
  taskId?: string;
  seedTableId?: string;
  changeType?: string;
  attempts?: number;
  maxAttempts?: number;
  lastError?: string;
  failureKind?: string;
  failurePhase?: string;
  failureReason?: string;
  failureDetails?: unknown;
  failedSql?: string;
  sqlFingerprint?: string;
  postgres?: ReproSqlExecution;
  steps?: unknown;
  edges?: unknown;
  seedRecordIds?: unknown;
  runId?: string;
  runTotalSteps?: number;
  runCompletedStepsBefore?: number;
  queue?: Array<{ id: string; status: string; attempts: number; lastError: string | null }>;
};

type DeadLetterRow = {
  id: string;
  seed_table_id: string;
  change_type: string;
  seed_record_ids: unknown;
  steps: unknown;
  edges: unknown;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  trace_data: unknown;
  run_id: string;
  run_total_steps: number;
  run_completed_steps_before: number;
};

type OutboxRow = {
  id: string;
  status: string;
  attempts: number;
  last_error: string | null;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const parseJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const readString = (record: Record<string, unknown> | undefined, key: string) => {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
};

const readNumber = (record: Record<string, unknown> | undefined, key: string) => {
  const value = record?.[key];
  return typeof value === 'number' ? value : undefined;
};

const buildFailure = (row: DeadLetterRow): ReproFailureReport => {
  const traceData = asRecord(parseJson(row.trace_data));
  const failure = asRecord(traceData?.failure);
  const execution = asRecord(traceData?.execution);
  const statement = asRecord(execution?.statement);
  const postgres = asRecord(execution?.postgres);

  return {
    kind: 'dead_letter',
    taskId: row.id,
    seedTableId: row.seed_table_id,
    changeType: row.change_type,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error ?? undefined,
    failureKind: readString(failure, 'kind'),
    failurePhase: readString(failure, 'phase'),
    failureReason: readString(failure, 'reason'),
    failureDetails: failure?.details,
    failedSql: readString(statement, 'normalizedSql'),
    sqlFingerprint: readString(statement, 'fingerprint'),
    postgres: postgres
      ? {
          sqlState: readString(postgres, 'sqlState'),
          severity: readString(postgres, 'severity'),
          position: readNumber(postgres, 'position'),
          routine: readString(postgres, 'routine'),
          table: readString(postgres, 'table'),
          column: readString(postgres, 'column'),
          dataType: readString(postgres, 'dataType'),
          constraint: readString(postgres, 'constraint'),
        }
      : undefined,
    steps: parseJson(row.steps),
    edges: parseJson(row.edges),
    seedRecordIds: parseJson(row.seed_record_ids),
    runId: row.run_id,
    runTotalSteps: row.run_total_steps,
    runCompletedStepsBefore: row.run_completed_steps_before,
  };
};

const toQueueRows = (rows: ReadonlyArray<OutboxRow>) =>
  rows.map((row) => ({
    id: row.id,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
  }));

/**
 * Read the terminal state left by a drain. Failures are read from the dead
 * letter first; leftover outbox rows are reported so a hung queue is not
 * mistaken for a clean run.
 */
export const captureFailure = async (
  db: Kysely<V1TeableDatabase>,
  baseId: string
): Promise<ReproFailureReport> => {
  const deadLetter = await sql<DeadLetterRow>`
    select "id", "seed_table_id", "change_type", "seed_record_ids", "steps", "edges",
           "attempts", "max_attempts", "last_error", "trace_data",
           "run_id", "run_total_steps", "run_completed_steps_before"
    from "computed_update_dead_letter"
    where "base_id" = ${baseId}
    order by "failed_at" desc
    limit 1
  `.execute(db);

  const queue = await sql<OutboxRow>`
    select "id", "status", "attempts", "last_error"
    from "computed_update_outbox"
    where "base_id" = ${baseId}
    order by "created_at" asc
    limit 20
  `.execute(db);

  if (deadLetter.rows[0]) {
    const report = buildFailure(deadLetter.rows[0]);
    return queue.rows.length ? { ...report, queue: toQueueRows(queue.rows) } : report;
  }

  if (queue.rows.length > 0) {
    return { kind: 'queue_leftover', queue: toQueueRows(queue.rows) };
  }

  return { kind: 'none' };
};
