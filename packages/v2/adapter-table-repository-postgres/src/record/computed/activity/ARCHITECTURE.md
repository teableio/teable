# Computed Activity (field/table compute metadata)

## Purpose

Maintain **runtime** compute metadata for fields and tables while the async
computed outbox processes formula/lookup/rollup work — without stuffing status
into field schema `meta` or overloading `is_pending`.

Enables Feishu-like UX:

- field "calculating"
- table "N formulas calculating / just completed + duration"
- extensible complexity / scale / diagnostics

## Domain

Core domain (`@teable/v2-core`):

- `FieldComputeMeta` / `TableComputeMeta` / `ComputeStatus`
- `ComputedActivity` pure aggregate for transitions
- `ComputedActivityBatchChanged` domain event (realtime follow-up)

## Projection store

| Table                     | Role                                                  |
| ------------------------- | ----------------------------------------------------- |
| `computed_field_activity` | Per-field status, refcount, complexity, last duration |
| `computed_table_activity` | Table summary + recent completions                    |
| `computed_task_field_ref` | Task→field set for idempotent refcount                |

## Lifecycle hooks

`ComputedActivityProjector` is invoked from `ComputedUpdateOutbox` in the same
transaction as outbox mutations. By default, lifecycle hooks update only the
task-field ref ledger in that caller transaction and enqueue event metadata for
the per-table async flusher. The flusher runs outside caller transactions,
rebuilds counters from persisted refs, and serializes activity-table updates
with a per-table advisory lock. Set `COMPUTED_ACTIVITY_ASYNC_PROJECTION=false`
only as an emergency rollback to the legacy synchronous projection path.

Claimed seed tasks do not yet know their computed targets; the worker registers
those targets after planning and before execution. Task-field refs make
refcounts idempotent and let claim/retry transitions reconcile from persisted
truth.

| Outbox                             | Activity                                              |
| ---------------------------------- | ----------------------------------------------------- |
| enqueue (create/merge)             | `onTaskEnqueued` → attach refs, status `queued`       |
| claim                              | `onTasksClaimed` → `running`                          |
| seed plan after claim              | attach discovered refs, status `running`              |
| markDone                           | `onTaskDone` → release refs, `lastDurationMs`, `idle` |
| markFailed terminal                | `onTaskFailed(terminal)` → release + `failed`         |
| markFailed retry / releaseForRetry | `onTaskFailed(!terminal)` → clear processing          |

`ComputedActivityBatchChanged` is published only after the enclosing transaction
commits. The realtime projector writes table and field documents to the
`cmp_{tableId}` ShareDB collection. Each aggregate transition increments every
changed document once. Activity generation is the ShareDB document version:
generation 1 creates the document and later generations replace its root at
version `generation - 1`. The backend snapshot loader authorizes normal clients
through field-read permissions and verifies that share-view clients request their
shared table. Reconnect recovery synthesizes only the missing `[from, generation)`
operation range from the latest snapshot.

## API

`GET /tables/getComputeActivity` validates the base/table association and runs the
normal table-read operation guard before reading diagnostics. Table DTO loaders
may also join activity rows and expose optional field/table `computeMeta`.

## Client integration

The grid owns one `ComputeActivityProvider` per mounted table. It combines the
HTTP snapshot with ShareDB updates, gives realtime field state precedence over
stale HTTP state, drives amber calculating headers, and keeps failed diagnostics
visible after active work stops.

## Non-goals

- Formula intermediate size limits
- Durable task history beyond the bounded recent-completion summary
