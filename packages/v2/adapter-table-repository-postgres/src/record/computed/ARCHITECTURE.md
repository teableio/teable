# Computed updates (hybrid mode) — execution and recovery

This document records the current v2 computed-update invariants for hybrid execution, durable
outbox stages, OpenTelemetry correlation, and administrator recovery. The database ledger is the
execution source of truth; BullMQ is a wake-up channel. A dead-letter archive is the failed task's
current stage, not automatically a durable copy of the original computation trigger.

The primary operational questions are whether a plan ran, how far it progressed, and whether its
archive contains an eligible seed trigger for a fresh rerun. Never resume archived continuation
state, and never report accepted queue delivery as successful or verified computation.

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

## Physical storage checks for computed writes

Before a step writes, the updater checks the physical columns required by fields with dirty targets. The catalog lookup is set-based, and its results are reused only within the current prepared operation and transaction; it is never cached across runs because integrity repair may recreate a column between runs. Propagation and update steps share the same operation-local result. Missing storage skips that field for the current step, while healthy fields continue; schema repair remains the path that recreates and backfills the storage.

The check is deliberately after the current level's dirty-count resolution. Generated-column fields and steps with no dirty targets do not trigger catalog reads. A catalog inspection failure leaves the original SQL path intact so a real database error remains visible.

## Stage continuation integrity

- Initial INSERT extras can be lock-only inputs. A completed stage's deferred plan
  uses UPDATE semantics for its actual dirty outputs; it must not promote untouched
  lock-only rows. DELETE retains its original semantics and before-images.
- Hybrid INSERT handoff evaluates inert return edges against the full stage before
  removing synchronous steps, then queues the remainder with UPDATE semantics.
  Sources computed in the synchronous prefix remain propagation inputs even when
  absent from the remaining steps. Preserve the filtered edges and omit lock-only
  extra seeds so continuation does not reintroduce inert sibling fan-out.
- A partial floor batch persists `partialStageBudget` with its ledger scope and
  whole-table cursors. Later batches must use the same partition even if worker
  configuration changes. Only a completed stage can reset that boundary.
- Terminal formula failures persist as `terminalFieldErrors` alongside the partial
  plan. Keep its original steps and edges until the floor partition drains; the
  updater skips those fields, while legal siblings commit and advance the ledger.
  Removing failed fields before draining could move deferred same-table fields
  into record exclusions belonging to a different partition.
- Failure fanout includes field/table/base ownership. Activity projection locks,
  loads and reconciles those targets even without task refs or prior activity
  rows; a dependency failure is not a successful completion or a synthetic task.
- Ledger settlement retains sources for deferred edges **and** pending same-record
  steps. Consuming a sibling table's frontier does not prove its formulas ran.
- Whole-table seed promotion covers surviving rows, not deleted sources. Retain
  relevant before-image IDs alongside whole-table markers through enqueue and
  retry merging, so later edges can still match deleted rows' old values.

The convergence gate checks command-input-derived values against raw stored cells
for every fixture row, including unrelated rows and link titles. It does not use
the computed query path as an oracle or treat an empty queue as correctness proof.
Shared HTTP scenarios run across bounded/unbounded PGlite execution profiles;
recovery and competing-worker tests use real PostgreSQL. CI runs those PostgreSQL
contracts on versions 16 and 17. Nightly/manual jobs expand seeded properties and
run isolated source mutations; only the intended value assertion counts as a kill.
Property failures print seed, shrink path, scenario and a replay command, and CI
uploads those details with test logs. Stable fixture ID ordering makes shrinking
and replay independent of random sibling-stage and frontier ordering.

---

## Same-table formula output types

Each formula CTE level must expose the scalar type declared by the field before
later levels consume it. A text-typed `IF(condition, ROUND(value), "")` may compile
to a numeric expression with a NULL branch; cast its output to text at the CTE
boundary, not only in the final UPDATE assignment. Otherwise a downstream text
comparison can force `''` to numeric and dead-letter the entire update.
Keep NULL values intact and retain JSON/array normalization for multi-value fields.
The same contract applies to individually compiled and grouped formula roots.

## Bounded import seeds

- `../repository/PostgresTableRecordRepository.ts` stages each inserted batch's record and field
  IDs; it does not retain imported `TableRecord` objects. Outbox seeds share the data transaction.
- Once seed storage spills to `computed_update_outbox_seed`, later small batches append there.
  A merge must neither reload all spilled IDs nor switch back to inline JSON and discard old seeds.
- Seed claims split oversized spilled input with a database cursor before hydrating a task.
  Child tasks use the existing chunk protocol, preserve before-images and source/run metadata,
  and roll back with their parent if the claim transaction fails.
- Insert continuations and their lineage-scoped descendants retain predecessor-scoped hashes;
  schema-only merging must not recombine bounded import chunks. Ordinary unscoped update/delete
  plan merging is unchanged.
- The legacy post-commit path spills only seed IDs to a private temporary file and replays bounded
  batches through its existing computation strategy. It is not a new durable queue.

## Goals

### G1. “Plan executed?” answerable via OTel

For any computed plan (sync or async), operators should be able to answer:

- Was a plan created/enqueued?
- Was it claimed by a worker?
- Did it execute successfully?
- If it failed: how many attempts, and did it end up in DLQ?
- If it partially executed: how far (progress), and where did it fail?

### G2. Safe dead-letter rerun

Fresh-run the archived task unit after clearing checkpoint-only progress: seed triggers re-plan,
planned stages rerun their archived plan/seeds, and field backfills restart their archived scope.
Reject only malformed archives that lack metadata required by their own task kind.

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

Given your preference “完全基于 OTel logs/metrics”: counters + histograms are the safest and lowest-coupling signals. The worker records
`v2.computed.outbox.source_to_settlement.duration` when a task commits settlement. Each observation is one task branch, not a whole merged logical run; `continued=false` identifies a terminal branch. It measures from the durable `source_changed_at` lineage clock and uses only `taskKind` and `continued` labels; task, run, table, field and trace IDs never become metric labels.

### Trace model (OTel Traces)

Traces are best for debugging a single incident (why slow / where failed), not for alerting.

- Enqueue captures one bounded W3C origin (`traceparent`, optional `tracestate`) in the task's existing `dirty_stats` envelope. A merge keeps the pending task's primary origin; it does not accumulate carrier arrays.
- Computed, seed and field-backfill claims reconstruct that origin from PostgreSQL. Every fixed-name `teable.worker.processClaimedTask` span starts under its own task origin, so a `runOnce` drain cannot attach unrelated tasks to the wakeup that happened to start the drain.
- Missing or invalid legacy origins establish an explicit root context, not the active wakeup's parent. Fresh mutation input captures active context even when its source clock is already stamped. Existing work is identified by predecessor/task identity or an explicit internal preservation boundary (claim-time seed splitting), never by `sourceChangedAt` alone; continuations and subsequent wakeups cannot recapture a consumer trace.
- Chunks and continuations retain the origin together with `runId`, `originRunIds`, `stageDepth`, `predecessorTaskId` and `sourceChangedAt`. The task span and terminal failure diagnostics expose those lineage values plus source-to-settlement/failure elapsed time.
- IDs remain span/log attributes, never span-name or metric-label components.

`computed:worker:long_continuation_chain` warns when source-to-current-settlement elapsed time reaches the dedicated 5-minute operational-delay threshold (`LONG_CONTINUATION_CHAIN_WARN_ELAPSED_MS`). `MAX_STAGE_DEPTH` remains the separate hard safety ceiling (50). The warning is diagnostic evidence, not an SLO or a new online alert rule.
---

## Dead-letter recovery contract

### Archive meaning and eligibility

`computed_update_dead_letter` stores the task unit that failed, not an immutable copy of the first
user mutation. A seed archive contains a persisted trigger and therefore re-plans against current
schema. A planned-stage archive contains the current stage's steps, edges and durable seeds; recovery
reruns that archived stage from its beginning. A field-backfill archive identifies its field scope;
recovery reruns that scope from the beginning rather than resuming its failed cursor.

Recovery is therefore a fresh run of the **archived task unit**, not checkpoint continuation and not
reconstruction of earlier completed stages. A malformed archive missing the metadata required by its
own task kind is rejected transactionally and remains in dead letter.

Before the first partial batch consumes a frontier, a previously empty ledger scope receives a
`rerun-input-v1` marker. Explicit and generated sources are retained as `rerun-source` SQL rows;
neither kind participates in normal frontier selection, exclusions, output collection or follow-on
planning. An existing legacy partial scope cannot obtain completeness from its remaining rows.
Terminal archival copies source membership into `computed_update_dead_letter_seed` before clearing
the live ledger/frontier, and preserves `seedAllTableIds` independently from discarded cursors.
The bounded `rerunInputs` manifest records version, completeness and archived row count. Restoration
validates it and uses `INSERT SELECT` into live seeds. The archived seed FK cascades on recovery or
discard. Historical partial archives with unknown capture completeness are refused and preserved,
even when some exact seeds remain. Ordinary non-partial exact-input archives remain supported.
Propagation target tables (`step.tableId`, `edge.toTableId`) do not have to appear in exact seed
membership. A complete historical A-only seed can legitimately propagate to B; eligibility rejects
unknown partial/cursor/lineage state, not the absence of pre-materialized output records.

Only restored planned tasks receive `plannedRerun` metadata. Before their first claim hydrates seed
rows, the outbox transfers the complete normalized membership SQL-side into task-owned frontier and
rerun-source rows, creates a fresh completeness marker, and empties the live seed child rows. The
claimed JS payload contains no unbounded ID list; existing stage dirty budgets consume the frontier.
Ordinary planned jobs retain their existing claim behavior. No archived checkpoints are reused.
Restored planned edges also discard only `propagationSourceFieldIds`, the archived delta-pruning
evidence. A source scalar may have committed before its linked output propagated; unchanged source
values during rerun do not prove that output is current. The logical edge (from/to/link/filter/target)
is preserved and follows the existing conservative no-provenance path across deferred rerun stages.
Ordinary non-rerun value gating is unchanged.

Deploy both additive migrations `20261102000000_add_computed_dead_letter_seed` and
`20261102010000_allow_computed_rerun_ledger_kinds` in both metadata editions and every BYODB database
before workers. The latter atomically replaces the production CHECK with old3+new2 valid kinds;
unsupported kinds remain rejected. Finish mixed-version rollout before admin recovery. No migration
reconstructs source membership already discarded by an earlier worker.

### Fresh-rerun transaction

The administrator single/exact-group path locks archive rows and atomically:

1. creates a new run identity while retaining the task ID used by failure/reliability evidence;
2. preserves the archived task unit: seed trigger, or planned steps/edges/seeds, or backfill fields;
3. resets attempts, locks, completed-step count, stage depth and predecessor;
4. removes checkpoint-only cursor, ledger scope, exclusion, partial-budget and terminal-error state;
5. stores restored seeds in `computed_update_outbox_seed`, leaving inline seed JSON null so the live
   task payload remains bounded;
6. deletes the archive only after the live task and seed rows are durable.

Seed workers plan from current schema. Planned workers execute the archived current-stage plan, and
backfill workers start the archived field scope without its old cursor. Any form may recompute more
work and cost more than resuming the failed checkpoint. Terminal archival clears both
`computed_update_stage_ledger` and `computed_update_change_frontier` for the continuation-chain scope,
so the fresh run cannot inherit stale exclusions or output evidence.

### Operational invariants

- Never recover before the underlying code, schema, data, capacity or infrastructure fix is live.
- Recovery requires administrator authorization and current default/BYODB routing checks.
- Single and group paths use a task-specific recovery plan hash; same-ID live rows remain
  idempotent and are not duplicated.
- BullMQ delivery happens after the durable transaction. Delivery failure leaves pending database
  work for later polling; delivery success does not prove execution success.
- Accepted/requeued is not recovered or verified. Close the incident only after task completion and
  independent value checks.
- `computed run-task` and `computed replay` execute live outbox rows only. They are not dead-letter
  recovery commands. Stale-lease re-arm is also distinct: it resets an expired live processing lease
  without creating a fresh run.

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

## Administrator interface

The admin anomaly view groups dead letters by exact target, base, seed table, normalized error
signature and worker lane. Single and group recovery call the reviewed service path; the UI never
mutates queue tables directly. The interface must describe the action as a fresh run of the archived
task unit and surface validation rejection only for malformed archives.

Minimum operator evidence:

- task/group identity, routing target, failure classification and last error;
- archived task kind and whether its required rerun metadata is structurally valid;
- durable recovery result separately from immediate BullMQ delivery;
- first subsequent claim/completion and independent computed-value verification;
- unresolved reliability evidence after submission.

## Notes / risks

- Recovery can trigger a larger current-schema plan than the failed stage and is administrator-only.
- Async trace carriers are persisted with archived task units; task/run attributes remain the
  fallback correlation when upstream sampling or carrier validation prevents parentage.
- Stuck-processing detection is easiest with DB-derived metrics; log-based TTL rules are the
  fallback when in-app database polling is prohibited.
