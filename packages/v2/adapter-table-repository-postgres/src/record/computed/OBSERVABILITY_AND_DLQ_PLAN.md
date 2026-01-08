# Computed Updates (Hybrid) — OTel Monitoring + DLQ Replay Plan

This document describes the **implementation plan** (no code in this change) for monitoring computed-update plans in **hybrid mode** (sync + async outbox) using **OpenTelemetry logs/metrics as the source of truth**, and supporting **dead-letter replay with the original task id**.

## Scope / constraints

- v2-only context (v2 container + v2 adapters)
- Prefer OpenTelemetry Collector as the aggregation backend
- **Primary**: OTel logs + metrics (Sentry is optional/secondary)
- Primary operational question: “did the computed plan execute, and how far did it get?”
- Primary operational action: “replay DLQ with original id”; if too complex → alert

## Current system (relevant files)

- Run context and span attributes:
  - `packages/v2/adapter-record-repository-postgres/src/computed/run/ComputedUpdateRunContext.ts`
- Outbox payload and plan hash:
  - `packages/v2/adapter-record-repository-postgres/src/computed/outbox/ComputedUpdateOutboxPayload.ts`
- Outbox interface:
  - `packages/v2/adapter-record-repository-postgres/src/computed/outbox/IComputedUpdateOutbox.ts`
- Outbox implementation and DLQ move on max attempts:
  - `packages/v2/adapter-record-repository-postgres/src/computed/outbox/ComputedUpdateOutbox.ts`
- Hybrid strategy and worker:
  - `packages/v2/adapter-record-repository-postgres/src/computed/strategies/HybridWithOutboxStrategy.ts`
  - `packages/v2/adapter-record-repository-postgres/src/computed/worker/ComputedUpdateWorker.ts`

## Goals

### G1. “Plan executed?” answerable via OTel

For any computed plan (sync or async), operators should be able to answer:

- Was a plan created/enqueued?
- Was it claimed by a worker?
- Did it finish successfully?
- If it failed: how many attempts, and did it end up in DLQ?
- If partial: how far (progress), and where did it fail?

### G2. DLQ replay with original task id

Allow a DLQ item to be **moved** back into outbox using the **same `id`** so correlation stays stable:

- `taskId` / `runId` / `originRunIds`
- `planHash`

### G3. Simple, strict alerting

- DLQ non-empty / new DLQ item ⇒ page
- processing stuck (locked too long) ⇒ page
- too complex (policy threshold) ⇒ page

## OTel-first observability design

### Correlation keys (standard attributes)

Standardize these attributes on logs/metrics/spans:

- `computed.runId`
- `computed.originRunIds` (logs can keep array; spans/metrics should use comma-joined string)
- `computed.taskId` (present for outbox tasks)
- `computed.planHash`
- `computed.baseId`
- `computed.seedTableId`
- `computed.changeType` (`insert`/`update`/`delete`)
- `computed.phase` (`full`/`sync`/`async`)
- `computed.totalSteps`
- `computed.completedStepsBefore`

Hard rule:

- every outbox-related log/metric MUST include `computed.taskId` + `computed.planHash`
- every run-related signal MUST include `computed.runId`

### OTel Logs (event stream)

The logs should reconstruct the task lifecycle as an event stream (state transitions).

Recommended minimal events (map to existing ones where possible):

- `computed:plan:created`
  - emitted when planner produces a plan (even if executed sync)
- `computed:outbox:enqueued`
  - `{ merged, attempts, maxAttempts, nextRunAt }`
- `computed:outbox:claimed`
  - `{ workerId, lockedAt }`
- `computed:outbox:task_started`
- `computed:outbox:task_succeeded`
  - `{ durationMs }`
- `computed:outbox:task_failed`
  - `{ error, durationMs? }`
- `computed:outbox:retry_scheduled`
  - already exists; ensure it includes correlation keys
- `computed:outbox:dead_letter`
  - already exists; ensure it includes correlation keys

DLQ replay events:

- `computed:dlq:replay_requested`
- `computed:dlq:replay_succeeded`
- `computed:dlq:replay_failed`

### OTel Metrics

Keep metric set small and stable.

Counters:

- `teable_computed_outbox_enqueue_total{merged="true|false", change_type}`
- `teable_computed_outbox_claim_total{result="ok|empty|err"}`
- `teable_computed_outbox_retry_scheduled_total`
- `teable_computed_outbox_dead_letter_total`
- `teable_computed_worker_task_failed_total{error_class?}`
- `teable_computed_dlq_replay_total{result="ok|err"}`

Histograms:

- `teable_computed_worker_task_duration_ms`

Gauges (optional; requires DB polling somewhere):

- `teable_computed_outbox_pending`
- `teable_computed_outbox_processing`
- `teable_computed_dlq_size`

Recommendation:

- **Prefer collector-side DB polling** (otel-collector `sqlquery` receiver) for gauges, to keep app “event-only”.

## Tracing (OTel Spans)

Keep spans as the tool for “single run deep debug”, not for alerting.

Minimum useful span attributes:

- Root: `teable.ComputedFieldUpdater.execute`
  - include `computed.*` attributes above
- Per-level and per-step spans should include:
  - `step.index`, `step.level`, `step.tableId`, `step.fieldIds`, `step.dirtyRecordCount`

Trace query workflow:

- Filter by `computed.runId` or `computed.taskId` to see the full chain.

## DLQ replay design (original id)

### Semantics

Replay is a **move** from `computed_update_dead_letter` back to `computed_update_outbox` using the **same `id`**.

- Keep:
  - `id`, `run_id`, `origin_run_ids`, `plan_hash`
  - `steps`, `edges`, seed payload
  - `run_total_steps`, `run_completed_steps_before`
  - `affected_*`, `sync_max_level`, `estimated_complexity`
- Reset:
  - `status = 'pending'`
  - `attempts = 0` (recommended for clean accounting)
  - `next_run_at = now()`
  - `locked_at/locked_by = null`, `last_error = null`
  - `updated_at = now()`

Seed spill rule:

- If inline seed exceeds `seedInlineLimit`, set `seed_record_ids = null` and insert into `computed_update_outbox_seed`.

### API surface (v2 adapter)

Add a dedicated method on the outbox port:

```ts
export interface IComputedUpdateOutbox {
  // ...existing
  replayDeadLetter(
    taskId: string,
    params: { resetAttempts?: boolean; now?: Date },
    context?: IExecutionContext
  ): Promise<Result<{ taskId: string }, DomainError>>;
}
```

Rationale:

- replay is a first-class operation (not “enqueue”) because it must preserve original id
- keeps replay logic DB-transactional and consistent with current outbox tables

### DB pseudocode (transaction)

```ts
// ReplayDeadLetter(taskId)
// TX START
const row = SELECT * FROM computed_update_dead_letter WHERE id=$taskId FOR UPDATE;
if (!row) return err(domainError.notFound({ message: 'DLQ item not found' }));

const seedGroups = row.seed_record_ids ?? load from dlq seed table (if you add one later);
const useSeedTable = count(seedGroups) > seedInlineLimit;

INSERT INTO computed_update_outbox(
  id,
  base_id,
  seed_table_id,
  seed_record_ids, // null if useSeedTable
  change_type,
  steps,
  edges,
  status,
  attempts,
  max_attempts,
  next_run_at,
  locked_at,
  locked_by,
  last_error,
  estimated_complexity,
  plan_hash,
  dirty_stats,
  run_id,
  origin_run_ids,
  run_total_steps,
  run_completed_steps_before,
  affected_table_ids,
  affected_field_ids,
  sync_max_level,
  created_at,
  updated_at
) VALUES (...)
ON CONFLICT (id) DO UPDATE ... // optional: either block or replace

if (useSeedTable) INSERT computed_update_outbox_seed rows

DELETE FROM computed_update_dead_letter WHERE id=$taskId;
// TX COMMIT
```

Design choice: on conflict

- safest default: **fail** if outbox already has the same `id` (avoid double-processing)
- alternative: replace outbox record (requires careful operational semantics)

## “Too complex” policy

The plan already carries `estimatedComplexity`. Introduce a policy threshold:

- if `estimatedComplexity >= threshold`:
  - emit `computed:plan:too_complex` log
  - increment `teable_computed_plan_too_complex_total`
  - alert (page) if crossing threshold is considered a correctness issue

Option A (recommended): still enqueue/run, but alert.

Option B (more defensive): short-circuit to DLQ with error `too_complex` (only if you want to prevent resource exhaustion).

## Alerting rules (collector / backend)

Priority-0:

- DLQ increases: alert on `teable_computed_outbox_dead_letter_total` rate > 0, or on `dlq_size > 0` gauge.

Priority-1:

- Stuck processing: outbox processing task with `locked_at < now()-5m`.

Priority-1 (policy):

- too complex: `teable_computed_plan_too_complex_total` increments.

## Collector + dashboards (OTel Collector centric)

Collector responsibilities:

- ingest:
  - OTLP traces / metrics / logs from app
- export:
  - traces → Tempo/Jaeger/SigNoz
  - logs → Loki/Elastic/SigNoz
  - metrics → Prometheus remote-write / SigNoz

DB polling for gauges (optional):

- `sqlquery` receiver runs:
  - `SELECT count(*) FROM computed_update_dead_letter` → `teable_computed_dlq_size`
  - `SELECT count(*) FROM computed_update_outbox WHERE status='pending'` → pending gauge
  - `SELECT count(*) FROM computed_update_outbox WHERE status='processing'` → processing gauge

## Playground built-in panel (future implementation)

The panel should be driven by **OTel-first signals**, with DB reads only for detail views if needed.

Views:

- DLQ list (priority): taskId/runId/baseId/seedTableId/attempts/failedAt/lastError
- Pending/processing list
- Per-task detail: show steps/edges counts + dirty stats

Actions:

- Replay DLQ by taskId (original id)
- (optional) Force claim/drain (admin-only)

## Implementation checklist (when you start coding)

1. Normalize structured log context

- ensure `toRunLogContext()` and outbox logs always include `computed.*` keys

2. Add metrics provider usage in v2 adapter

- counters/histograms for enqueue/claim/retry/dlq

3. Implement `replayDeadLetter()` in outbox

- transactional move + seed spill logic

4. Add admin endpoints (playground)

- list DLQ
- replay DLQ

5. Add alerts + dashboards

- collector config
- grafana/sigNoz panels
