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
commits. The realtime projection converts it into one payload-free presence
signal per affected table on the table action-trigger channel
(`getActionTriggerChannel(tableId)`, action key `computeActivityChanged`).
Subscribers treat it as an invalidation hint and refetch the permission-scoped
snapshot over HTTP; the signal itself carries no activity data, so it needs no
per-field authorization. The async flusher already debounces per table, so the
signal rate is bounded by that debounce rather than by task count.

## API

`GET /tables/getComputeActivity` validates the base/table association and runs the
normal table-read operation guard before reading diagnostics. Table DTO loaders
may also join activity rows and expose optional field/table `computeMeta`.

## Read coalescing

Every viewer of a table polls the same shared projection, so the adapter stores
each `(table, readable-field scope, read options)` read for a short retention
window and shares one in-flight read between concurrent callers
(`ComputedActivityReadCoalescer`). The key never reduces to the table alone: an
unrestricted reader and a reader with nothing readable produce different
snapshots, so the scope is part of the identity.

Reuse is not time-based freshness. Before a stored snapshot is served, the reader
re-reads the projection version (`computed_field_activity` /
`computed_table_activity` `updated_at` + `generation`) and drops the entry when it
moved, because a client consumes compute-activity notices up to the request it is
about to answer — a snapshot older than that notice would hide the final `idle`
until the fallback poll. A snapshot may only be stored under a version that
brackets it: the reader reads the version before the snapshot and again after it
and stores the entry only when both agree, so a write that commits while the read
is in flight can never sit behind an entry whose label never moved. Reading the
version _before_ the snapshot is the safe order — a later write makes the entry
miss on revalidation instead of serving pre-write rows — and a table whose version
cannot be read is read but never stored. Callers bound to a caller-owned
transaction bypass the cache, and unbudgeted reads stay strict, so both always
observe the projection as of now. The retention window therefore bounds
pause/reliability staleness and memory, not activity freshness.

A read budget is validated before any reuse decision, so a rejected budget is
never answered from a stored snapshot. A caller waiting on a shared read or on
its own revalidation is bounded by its own deadline, while the executing read
keeps its own statement cancellation and rollback.
`COMPUTED_ACTIVITY_READ_CACHE_MS=0` restores one read per request;
`COMPUTED_ACTIVITY_READ_CACHE_MAX_ENTRIES` bounds the per-pod entry count.

## Client integration

The grid owns one `ComputeActivityProvider` per mounted table. Field and table
status come from `GET /tables/getComputeActivity` (permission-scoped). Presence
`computeActivityChanged` is a local invalidation notice: the client records an
unconsumed sequence, coalesces while a request or timer is already pending, and
starts HTTP at most once per second with no overlap. Coverage is recorded when
the request actually starts; a successful response consumes notices up to that
point. After the query function settles, a 0ms timer starts at most one
trailing request when `noticeSeq` advanced past that request's coverage. That
timer is the completion signal — not a React `isFetching` true→false paint.
Failed reads do not consume notices. Fallback poll is 15s while a table is
active, has issues, or the last read failed, and 60s when idle. Success
deadlines are measured from the last successful read — a fresh presence fetch
resets that deadline. Failure
deadlines start from now so an expired success clock cannot spin. Hidden tabs
keep noticing but cancel unsent auto-refresh; becoming visible issues one
catch-up. Remounting onto a still-fresh Query cache restores both the success
clock and the 1s start-interval clock from `dataUpdatedAt`, then rearms poll.
Restricted readers see only the fields the HTTP endpoint leaves in the response.

## Non-goals

- Formula intermediate size limits
- Durable task history beyond the bounded recent-completion summary
