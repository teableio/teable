# Computed Plan Observability & DLQ Replay (OTel Logs/Metrics)

Scope: v2 computed update pipeline in `@teable/v2-adapter-record-repository-postgres`.

Goals:

- Observe whether a computed **plan** executed (sync + async stages), using **OTel logs/metrics** (collector-first).
- Make DLQ replay the primary remediation path.
- If plan is too complex / keeps failing → alert.

Non-goals:

- Trace-first UX (traces remain useful, but do not gate ops).
- External queue (BullMQ) – computed uses Postgres outbox.

---

## 1) What we already have

### Hybrid execution model

- Sync phase runs immediately (some levels/steps).
- Async phase is persisted to `computed_update_outbox` and processed by:
  - Inline dispatch (push/hybrid) OR
  - `ComputedUpdatePollingService` polling (external/hybrid).

Entry points:

- `packages/v2/adapter-record-repository-postgres/src/computed/strategies/HybridWithOutboxStrategy.ts`
- `packages/v2/adapter-record-repository-postgres/src/computed/worker/ComputedUpdateWorker.ts`
- `packages/v2/adapter-record-repository-postgres/src/computed/outbox/ComputedUpdateOutbox.ts`

### DLQ

- On repeated failures, task is moved to `computed_update_dead_letter`.
- Importantly, DLQ rows already carry:
  - `id` (original task id)
  - `run_id` and `origin_run_ids`
  - `plan_hash`, `steps`, `edges`, `seed_record_ids`
  - `failed_at`, `last_error`, `attempts/max_attempts`

---

## 2) OTel logs/metrics strategy (collector-first)

### Why logs-first

- The pipeline already emits structured log events with stable names like:
  - `computed:run:start`, `computed:run:done`, `computed:run:queued`
  - `computed:outbox:retry_scheduled`, `computed:outbox:dead_letter`
- Those are perfect as a single source of truth for:
  - dashboards (LogQL / ClickHouse / Elasticsearch)
  - metrics derived by OTel Collector (transform) or backend (spanmetrics/logs2metrics)
  - alerting (DLQ exists, retry storm, long queue latency)

### Event taxonomy (must be stable)

Emit (or ensure we emit) log events at **state transitions**:

**Run / plan lifecycle**

- `computed:run:start`
  - keys: `computedRunId`, `computedRunPhase`, `computedRunTotalSteps`, `computedRunCompletedBefore`, `baseId`, `seedTableId`, `changeType`
- `computed:run:queued`
  - keys: `computedRunId`, `computedTaskId`, `planHash`, `pendingSteps`, `syncMaxLevel`
- `computed:run:done`
  - keys: `computedRunId`, `computedRunPhase`, `completedSteps`, `pendingSteps`, `durationMs`

**Outbox lifecycle**

- `computed:outbox:enqueued` / `computed:outbox:merged`
  - keys: `taskId`, `merged`, `seedCount`, `runId`, `originRunIds`, `planHash`
- `computed:outbox:claimed`
  - keys: `workerId`, `claimedCount`, `taskIds?`
- `computed:outbox:done`
  - keys: `taskId`
- `computed:outbox:task_failed`
  - keys: `taskId`, `error`, `attempts`, `maxAttempts`, `runId`
- `computed:outbox:retry_scheduled`
  - keys: `taskId`, `attempts`, `nextRunAt`
- `computed:outbox:dead_letter`
  - keys: `taskId`, `error`, `attempts`, `maxAttempts`, `runId`

**Replay**

- `computed:outbox:replayed`
  - keys: `taskId` (original id), `replayStrategy`, `resetAttempts`, `previousAttempts`

### OTel collector metrics (recommended)

Derive counters & SLO-style metrics from logs:

- Counter: `teable.computed.dead_letter_total` (increment on `computed:outbox:dead_letter`)
- Counter: `teable.computed.replay_total` (increment on `computed:outbox:replayed`)
- Counter: `teable.computed.retry_scheduled_total` (increment on `computed:outbox:retry_scheduled`)
- Histogram (optional): `teable.computed.run_duration_ms` (from `computed:run:done.durationMs`)

Alerting:

- **DLQ any**: `dead_letter_total > 0` in last N minutes OR DLQ depth query (see panel endpoints)
- **Retry storm**: high rate of `retry_scheduled_total`
- **Stuck processing** (optional): detect `status=processing` older than threshold via SQL / logs

---

## 3) DLQ replay: chosen scheme (preserve original id)

### Requirements

- Replay uses the **original task id**.
- Replay is safe and idempotent.
- Replay is observable (logs/metrics).

### Chosen replay semantics

When replaying DLQ task `id = X`:

1. Lock and read `computed_update_dead_letter.id = X`.
2. Ensure `computed_update_outbox.id = X` does not already exist.
3. Insert a new outbox row with the **same id**:
   - `status = pending`, `next_run_at = now`, `locked_* = null`, `last_error = null`
   - `attempts = 0` (reset retries)
   - keep `run_id`, `origin_run_ids`, `plan_hash`, `steps`, `edges`, `seed_record_ids`, etc.
4. If seed size is too large, spill to `computed_update_outbox_seed` (same logic as normal enqueue).
5. Delete the DLQ row (so “DLQ exists” alert clears).
6. Emit `computed:outbox:replayed`.

Rationale:

- Resetting attempts gives a full retry budget after human intervention.
- Deleting DLQ row ensures DLQ alerts reflect current state.

---

## 4) Playground built-in operations

Expose server endpoints (no UI required initially):

- List DLQ tasks (paginate, filter by base/table).
- Replay a DLQ task by id.

The panel/UI can be built on top later.

---

## 5) Implementation map (where to change)

Outbox (core of replay):

- `packages/v2/adapter-record-repository-postgres/src/computed/outbox/IComputedUpdateOutbox.ts`
- `packages/v2/adapter-record-repository-postgres/src/computed/outbox/ComputedUpdateOutbox.ts`

Worker/polling logs:

- `packages/v2/adapter-record-repository-postgres/src/computed/worker/ComputedUpdateWorker.ts`

Playground endpoints:

- `apps/playground/src/routes/api.computed.deadletter.ts`
- `apps/playground/src/routes/api.computed.deadletter.$taskId.replay.ts`

---

## 6) Operational workflow

Default:

- Hybrid mode runs sync, enqueues async.

If DLQ happens:

1. Alert triggers on `computed:outbox:dead_letter`.
2. Operator opens playground endpoint and inspects row (error + payload).
3. Decide:
   - Replay immediately (most common)
   - If repeated failures / high complexity → escalate (bugfix or disable problematic field)
4. Replay and watch:
   - new `computed:outbox:replayed` log
   - subsequent `computed:run:*` / `computed:outbox:*` logs
