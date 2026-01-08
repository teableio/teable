# Computed Observability & DLQ Replay (OTel-first)

This document defines an **OTel-first** observability and DLQ replay approach for the v2 computed update pipeline.

Scope:

- Hybrid strategy (`HybridWithOutboxStrategy`) sync+async execution
- Postgres outbox worker (`ComputedUpdateWorker` + `ComputedUpdatePollingService`)
- Dead-letter handling (`computed_update_dead_letter`)

Non-goals:

- Sentry-based monitoring (allowed as fallback, but not required)
- Cross-system context (this design assumes v2 internal context)

---

## Goals

1. Answer: “Did a computed plan execute? How far did it get?”
2. Operational signal is **only** from OpenTelemetry **logs + metrics** (collector-driven).
3. DLQ replay is the primary remediation, using the **original `taskId`**.
4. If tasks are “too complex” (high estimated complexity / large dirty set), alert rather than attempting fragile automation.

---

## Existing Pipeline (what we already have)

Key components:

- Planning & step execution spans in `packages/v2/adapter-record-repository-postgres/src/computed/ComputedFieldUpdater.ts`
- Hybrid orchestration in `packages/v2/adapter-record-repository-postgres/src/computed/strategies/HybridWithOutboxStrategy.ts`
- Outbox persistence + retry + DLQ move in `packages/v2/adapter-record-repository-postgres/src/computed/outbox/ComputedUpdateOutbox.ts`
- Worker execution + next-stage chaining in `packages/v2/adapter-record-repository-postgres/src/computed/worker/ComputedUpdateWorker.ts`
- Poll loop in `packages/v2/adapter-record-repository-postgres/src/computed/worker/ComputedUpdatePollingService.ts`

The DB schema already supports:

- `computed_update_outbox` (pending/processing)
- `computed_update_outbox_seed` (spill large seeds)
- `computed_update_dead_letter` (dead tasks)

---

## OTel Observability Contract

### 1) Logs (structured)

We standardize on:

- `message`: stable event name (already used widely)
- `computed.*` fields: consistent keys across all events

Recommended minimal keys (include wherever relevant):

- `computed.runId`
- `computed.originRunIds` (comma string is OK; or array if logger supports)
- `computed.taskId`
- `computed.phase` (`sync` | `async` | `full`)
- `computed.planHash`
- `computed.changeType`
- `computed.attempts`, `computed.maxAttempts`
- `computed.estimatedComplexity`
- `computed.seedTableId`, `computed.baseId`

Log events (canonical):

- `computed:outbox:enqueued` (+ `merged: boolean`)
- `computed:outbox:claimed` (+ `workerId`, `count`)
- `computed:outbox:task_done` (+ `durationMs`)
- `computed:outbox:task_failed` (+ `error`)
- `computed:outbox:retry_scheduled` (+ `nextRunAt`)
- `computed:outbox:dead_letter` (+ `failedAt`)
- `computed:dlq:replay_requested`
- `computed:dlq:replay_succeeded`
- `computed:dlq:replay_failed`

Why logs are first-class:

- OTel Collector can ingest JSON logs (stdout/filelog receiver, or SDK log exporter)
- Alerts can be built from log-based metrics if needed

### 2) Metrics

Metrics are intentionally low-cardinality.

Counters:

- `teable.computed.outbox.enqueue_total` attributes: `merged`, `change_type`
- `teable.computed.outbox.claim_total`
- `teable.computed.outbox.retry_scheduled_total`
- `teable.computed.outbox.dead_letter_total`
- `teable.computed.worker.task_failed_total`
- `teable.computed.dlq.replay_total` attributes: `result` (`ok`|`err`)

Histogram:

- `teable.computed.worker.task_duration_ms`

Avoid in metrics attributes:

- `taskId`, `runId`, `baseId`, `seedTableId` (too high-cardinality)

---

## Trace Correlation (optional, but keep it)

Traces are great for root cause, but operations rely on logs/metrics.

We keep existing span attributes from:

- `ComputedUpdateRun` span: run/phase/progress
- `ComputedFieldUpdater.execute` span: step counts, dirty counts, tables

For async boundary correlation:

- Use `computed.runId` and `computed.taskId` in log fields; collector can correlate even if trace context doesn’t propagate.

---

## DLQ Replay (original taskId)

### Semantics

Replay is a **move**:

- `computed_update_dead_letter` → `computed_update_outbox`
- Keep the same `id` (original `taskId`)

Resets on replay:

- `status = 'pending'`
- `attempts = 0`
- `next_run_at = now()`
- `locked_at/locked_by = null`
- `last_error = null`
- `updated_at = now()`

Keeps on replay:

- `id`, `run_id`, `origin_run_ids`, `plan_hash`
- `steps`, `edges`, `dirty_stats`
- `run_total_steps`, `run_completed_steps_before`

Seed handling:

- DLQ stores `seed_record_ids` inline (jsonb)
- On replay, if seed count > `seedInlineLimit`, spill into `computed_update_outbox_seed` and set `seed_record_ids = null`

### Pseudocode (transaction)

```ts
// replayDeadLetter(taskId)
// - must be SERIALIZABLE-safe; use SELECT ... FOR UPDATE

trx = begin
row = SELECT * FROM computed_update_dead_letter WHERE id = $taskId FOR UPDATE
if !row: return notFound

existing = SELECT id FROM computed_update_outbox WHERE id = $taskId
if existing: return conflict

seedGroups = parse(row.seed_record_ids)
if count(seedGroups) > seedInlineLimit:
  INSERT seed rows into computed_update_outbox_seed (task_id=$taskId, ...)
  outboxSeedRecordIds = null
else
  outboxSeedRecordIds = row.seed_record_ids

INSERT INTO computed_update_outbox (
  id, base_id, seed_table_id, seed_record_ids, change_type,
  steps, edges,
  status, attempts, max_attempts,
  next_run_at, locked_at, locked_by, last_error,
  estimated_complexity, plan_hash, dirty_stats,
  run_id, origin_run_ids, run_total_steps, run_completed_steps_before,
  affected_table_ids, affected_field_ids, sync_max_level,
  created_at, updated_at
) VALUES (
  row.id, row.base_id, row.seed_table_id, outboxSeedRecordIds, row.change_type,
  row.steps, row.edges,
  'pending', 0, row.max_attempts,
  now(), null, null, null,
  row.estimated_complexity, row.plan_hash, row.dirty_stats,
  row.run_id, row.origin_run_ids, row.run_total_steps, row.run_completed_steps_before,
  row.affected_table_ids, row.affected_field_ids, row.sync_max_level,
  row.created_at, now()
)

DELETE FROM computed_update_dead_letter WHERE id = $taskId
commit
```

---

## Alerts

Keep it intentionally simple:

1. **DLQ non-empty** (P0)

- Trigger: `teable.computed.outbox.dead_letter_total` increases
- Or: log-based alert on `computed:outbox:dead_letter`

2. **Stuck processing** (P1)

- Trigger: `computed_update_outbox` has `status='processing'` and `locked_at < now()-5m`.
- This can be implemented as a DB check by an external monitor, or as a periodic internal task that emits a log/metric.

3. **Too complex** (P1)

- Trigger on DLQ move when `estimated_complexity >= threshold` OR `dirtyStats.total >= threshold`

---

## Playground Built-in Panel (hybrid)

Implementation approach:

- List DLQ rows via a lightweight API.
- Replay action calls replay API.
- Display live events via existing `/api/logs/stream` (filter by `computed:*`).

Note: even if the panel reads directly from DB, **alerting** still stays OTel-only.
