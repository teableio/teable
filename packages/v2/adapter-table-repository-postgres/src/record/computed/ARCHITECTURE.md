# Computed updates (hybrid mode) — Observability & DLQ Replay Plan

This document describes the **operational plan** for monitoring computed-update plans in **hybrid mode** (sync + async outbox), using **OpenTelemetry logs + metrics as the source of truth**, and adding **dead-letter replay (original task id)**.

Scope constraints (as requested)

- v2-only context (v2 container + v2 adapters)
- Prefer OTel Collector as the backend
- Sentry is optional/secondary; primary signals are OTel logs/metrics
- Primary operational question: “did the computed plan execute, and how far did it get?”
- Primary operational action: “replay DLQ with original id”; if too complex, alert

---

## Current system (facts from repo)

- Runs are identified via `ComputedUpdateRunContext` and exposed as structured context:
  - `packages/v2/adapter-record-repository-postgres/src/computed/run/ComputedUpdateRunContext.ts`
- Outbox payload includes run metadata and plan hash:
  - `packages/v2/adapter-record-repository-postgres/src/computed/outbox/ComputedUpdateOutboxPayload.ts`
- Outbox interface supports enqueue/claim/done/failed:
  - `packages/v2/adapter-record-repository-postgres/src/computed/outbox/IComputedUpdateOutbox.ts`
- When max attempts is reached, tasks are moved to `computed_update_dead_letter` and a warning log is emitted:
  - `packages/v2/adapter-record-repository-postgres/src/computed/outbox/ComputedUpdateOutbox.ts` (`computed:outbox:dead_letter`)
- There is existing tracing instrumentation (spans) for computed execution as documented here and in `ComputedFieldUpdater`.

---

## Goals

### G1. “Plan executed?” answerable via OTel

For any computed plan (sync or async), operators should be able to answer:

- Was a plan created/enqueued?
- Was it claimed by a worker?
- Did it execute successfully?
- If it failed: how many attempts, and did it end up in DLQ?
- If it partially executed: how far (progress), and where did it fail?

### G2. DLQ replay with original task id

Allow a DLQ item to be **moved back** into outbox using the **same `id`** so all correlations (`taskId`, `runId`, `originRunIds`, `planHash`) remain consistent.

### G3. Simple, strict alerting

- If DLQ has new items (or count > 0): alert
- If outbox processing appears stuck: alert
- If a task is “too complex” (policy threshold): alert

---

## OTel-first observability design

### Correlation model

We already have stable identifiers; standardize them as attributes on logs/metrics/spans:

- `computed.runId` (string)
- `computed.originRunIds` (comma-joined string or array only in logs)
- `computed.taskId` (string, for outbox tasks)
- `computed.planHash` (string)
- `computed.baseId`, `computed.seedTableId` (string)
- `computed.changeType` (insert/update/delete)
- `computed.phase` (`full`/`sync`/`async` as per `ComputedUpdateRunContext`)
- `computed.totalSteps`, `computed.completedStepsBefore`

Rule: **every outbox-related log/metric MUST include `computed.taskId` and `computed.planHash`**; every run-related signal MUST include `computed.runId`.

### Event model (OTel Logs)

Keep the existing structured logs, but ensure they form an “event stream” that can reconstruct state transitions.

Recommended minimal event set (names can map to existing ones):

- `computed:plan:created`
  - emitted when planner produces a plan (even if executed sync)
- `computed:outbox:enqueued`
  - include `{ merged, nextRunAt, attempts=0, maxAttempts }`
- `computed:outbox:claimed`
  - include `{ workerId, lockTtlMs?, lockedAt }`
- `computed:outbox:task_started`
  - include `{ taskId, runId }`
- `computed:outbox:task_succeeded`
  - include `{ durationMs }`
- `computed:outbox:retry_scheduled`
  - already exists; ensure it includes all correlation fields
- `computed:outbox:dead_letter`
  - already exists; ensure it includes all correlation fields
- `computed:dlq:replay_requested`
- `computed:dlq:replay_succeeded`
- `computed:dlq:replay_failed`

These are OTel Logs (or log records) that flow to the collector. The panel and alerts can be driven purely by logs/metrics, but metrics are preferred for alerting.

### Metric model (OTel Metrics)

Define a small stable set of instruments. Names below are examples; choose one naming convention and keep it consistent.

Counters:

- `teable_computed_outbox_enqueue_total{merged="true|false", change_type}`
- `teable_computed_outbox_claim_total{result="ok|empty|err"}`
- `teable_computed_outbox_retry_scheduled_total`
- `teable_computed_outbox_dead_letter_total`
- `teable_computed_worker_task_failed_total{error_class?}`
- `teable_computed_dlq_replay_total{result="ok|err"}`

Histograms:

- `teable_computed_worker_task_duration_ms`
  - record duration of worker processing for a single task

Gauges (optional if you have a good collector-side DB check; otherwise implement):

- `teable_computed_outbox_pending`
- `teable_computed_outbox_processing`
- `teable_computed_dlq_size`

Design note: gauges often require polling the DB. If you want **strictly “no DB polling in-app”**, then skip gauges and rely on:

- counters (dead letter/retry)
- log-based stuck detection (requires log-based rules)
- or collector-side “dbquery receiver”/exporter strategy

Given your preference “完全基于 OTel logs/metrics”: counters + histogram are the safest and lowest coupling.

### Trace model (OTel Traces)

Traces are best for debugging a single incident (why slow / where failed), not for alerting.

- Ensure async tasks (outbox worker) create a span with attributes: `computed.taskId`, `computed.runId`, `computed.planHash`
- Ensure step-level spans include `step.index`, `step.level`, `step.tableId`, `step.fieldIds`

If trace context does not propagate across async boundaries, do NOT rely on trace parent/child. Use attribute correlation for linking.

---

## DLQ replay: semantics and design

### Replay semantics

Replay is a **move**:

- FROM: `computed_update_dead_letter`
- TO: `computed_update_outbox`
- WITH: same `id`

Keep:

- `id` (taskId)
- `run_id`, `origin_run_ids`
- `plan_hash`
- payload (`steps`, `edges`, seed groups)
- `run_total_steps`, `run_completed_steps_before`
- `affected_table_ids`, `affected_field_ids`, `sync_max_level`

Reset:

- `status = 'pending'`
- `attempts = 0` (recommended)
- `next_run_at = now()`
- `locked_at/locked_by = null`
- `last_error = null`
- `updated_at = now()`

Seed storage rule:

- If inline seed groups exceed `seedInlineLimit`, spill to `computed_update_outbox_seed` and set `seed_record_ids = null`.

### API surface (v2-only)

Add a method on the outbox port (or a sibling admin port) rather than having the UI manipulate tables directly.

Option A (preferred): extend `IComputedUpdateOutbox`

- `replayDeadLetter(taskId: string, params?: { resetAttempts?: boolean }, context?: IExecutionContext): Promise<Result<{ replayed: boolean }, DomainError>>`

Option B: new port `IComputedUpdateAdmin`

- `listDeadLetters(...)`
- `replayDeadLetter(...)`
- `listOutbox(...)`

Option B keeps operational concerns separate from core outbox semantics.

### Implementation sketch (Kysely + transaction)

Pseudocode:

```ts
// replayDeadLetter(taskId)
return runInTransaction(db, context, async (trx) => {
  const dlq = await trx
    .selectFrom(DEAD_LETTER_TABLE)
    .selectAll()
    .where("id", "=", taskId)
    .forUpdate()
    .executeTakeFirst();

  if (!dlq) return ok({ replayed: false });

  // Build seedGroups (inline JSON) or load from existing structure if any
  // Decide spill-to-seed-table based on config.seedInlineLimit

  await trx.insertInto(OUTBOX_TABLE).values({
    id: dlq.id,
    base_id: dlq.base_id,
    seed_table_id: dlq.seed_table_id,
    seed_record_ids: useSeedTable ? null : dlq.seed_record_ids,
    change_type: dlq.change_type,
    steps: dlq.steps,
    edges: dlq.edges,
    status: "pending",
    attempts: 0,
    max_attempts: dlq.max_attempts,
    next_run_at: now,
    locked_at: null,
    locked_by: null,
    last_error: null,
    estimated_complexity: dlq.estimated_complexity,
    plan_hash: dlq.plan_hash,
    dirty_stats: dlq.dirty_stats,
    run_id: dlq.run_id,
    origin_run_ids: dlq.origin_run_ids,
    run_total_steps: dlq.run_total_steps,
    run_completed_steps_before: dlq.run_completed_steps_before,
    affected_table_ids: dlq.affected_table_ids,
    affected_field_ids: dlq.affected_field_ids,
    sync_max_level: dlq.sync_max_level,
    created_at: dlq.created_at, // or now
    updated_at: now,
  });

  if (useSeedTable) {
    await insertSeedRows(trx, taskId, flattenSeedGroups(seedGroups));
  }

  await trx.deleteFrom(DEAD_LETTER_TABLE).where("id", "=", taskId).execute();

  return ok({ replayed: true });
});
```

Convergence/invariants:

- Must be idempotent if called twice:
  - second call should see no DLQ row and return `replayed: false`.
  - protect against duplicates in outbox by primary key on `id`.
- If outbox already has `id` (rare):
  - either return `err(domainError.conflict(...))`
  - or treat as `replayed: false`.

---

## Complexity policy (“too complex then alert”)

Define a policy that can be evaluated using already available metadata:

Signals:

- `estimatedComplexity` (already in payload)
- `dirtyStats` (counts)
- `steps.length`, `edges.length`

Policy example:

- “too complex” if `estimatedComplexity >= X` OR `sum(dirtyStats.totalDirty) >= Y`

Operational behavior:

- Still allow enqueue, but:
  - emit a `computed:plan:too_complex` log
  - increment `teable_computed_plan_too_complex_total`
  - optionally force `dispatchMode='external'` (safer)

If the plan ends up DLQ and it was too complex, escalate alert severity.

---

## Alerting rules (OTel Collector downstream)

### Rule 1: DLQ non-empty / DLQ increased (P0)

- Alert when `teable_computed_outbox_dead_letter_total` increases in a window, OR
- Alert when a log record matches `computed:outbox:dead_letter`.

### Rule 2: Stuck processing (P1)

Two approaches:

- Metric-based (needs gauge or collector-side DB query):
  - outbox `processing` count > 0 and oldest lock age > 5m
- Log-based (no DB polling):
  - `computed:outbox:claimed` exists for `taskId` but no `task_succeeded`/`dead_letter`/`retry_scheduled` within TTL.

### Rule 3: High complexity DLQ (P1)

- Alert when dead letter event includes `estimatedComplexity >= X`.

---

## Playground built-in panel (hybrid mode)

Goal: provide an **internal panel** (playground only) to inspect and replay.

Because you requested “完全基于 OTel logs/metrics”, the panel can either:

- Option 1 (pure OTel): query your log/metrics backend (SigNoz/Grafana Loki/Tempo) from the panel.

  - Pros: no extra DB endpoints
  - Cons: depends on your observability backend having an API accessible from playground

- Option 2 (v2-only endpoints): the panel queries the v2 service which reads DB and also emits OTel.
  - Pros: works standalone
  - Cons: panel is not “pure OTel”, but OTel remains the truth for monitoring/alerts.

Given “deadletter 重放优先”, Option 2 is usually required anyway (replay mutates DB).

Minimal panel features:

- List DLQ rows (id/runId/baseId/failedAt/lastError/attempts)
- View details (steps/edges counts, dirtyStats summary)
- Replay button (calls replay API)

---

## Implementation checklist (when you decide to implement)

1. Add OTel metrics instruments in worker/outbox strategy codepaths:
   - enqueue, claim, fail→retry, fail→dead-letter, replay
2. Ensure all existing outbox logs include correlation fields via `toRunLogContext(...)` plus `planHash`
3. Add replay method (transactional move DLQ→outbox) preserving original id
4. Add playground internal endpoints + minimal UI
5. Add tests for replay idempotency and seed spill behavior

---

## Notes / Risks

- Async trace context propagation across worker boundaries is typically not automatic; rely on attributes (`taskId/runId/planHash`) for correlation.
- “Stuck processing” detection is easiest with DB-derived metrics; if you require OTel-only without DB polling, prefer log-based TTL rules.
- Replay should be guarded (admin-only) because it can trigger large recomputation.
