Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# application/projections Architecture Notes

## Responsibilities

- Define projection types that bind Domain Events to derived effects.
- Provide an alias decorator for projection event bindings.
- Keep projections as EventHandlers (no event type branching inside handlers).
- Record realtime actor projections reuse the exact base/table aggregate supplied by the
  successful `DomainWriteTransaction` for that commit's own awaited and background direct
  delivery. A restricted table lookup is active only while that delivery executes; even a
  copied context loses access when delivery ends. The supplied map and original request
  context are never mutated. Background scopes start inside their scheduled callback, and
  nested writes strip upstream lookups. This is not a request-wide or cross-transaction
  metadata cache. Physical actor rows and versions are still read from storage. Missing,
  non-aggregate, or mismatched entries use the existing
  `activeWithPending` repository lookup, including its not-found behavior, and construct the
  repository spec only on that fallback path. Schema-lease escalation still releases shared,
  acquires exclusive, and reloads metadata.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe projection scope.
- `DurableProjection.ts` - Role: durable projection decorator; Purpose: opt-in at-least-once consumers with stable ids.
- `SameTxProjection.ts` - Role: same-tx projection decorator; Purpose: bind `@SameTxProjectionHandler`
  projections (strict `instanceof` / explicit `eventName`) to run inside active record, schema,
  table, or view write transactions, failing closed on missing DI handlers or errors and filtered out
  of post-commit memory event buses to avoid double execution.
- `recordProjectionCodecs.ts` - Role: record event codecs; Purpose: encode/decode immutable outbox DTOs.
- `Projection.ts` - Role: projection alias; Purpose: define IProjection and the ProjectionHandler decorator.
- `RealtimeProjection.ts` - Role: marker type; Purpose: label projections that target realtime engines.
- `readRealtimeRecordActors.ts` - Role: shared create/update actor reader; Purpose: read exact
  mutation-authorized record IDs using the committed table when available. Single and batch
  create/update projections share it; delete projections remove documents without reading
  actors from rows that no longer exist.
- `TableCreatedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish table and field
  snapshots on create or restore.
- `TableProvisionReadyRealtimeProjection.ts` - Role: realtime projection; Purpose: re-ensure only
  the persisted Table document after a physical schema change returns to ready, restoring table-list
  visibility without re-ensuring unaffected field documents.
- `FieldCreatedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish field snapshots on create.
- `FieldDeletedRealtimeProjection.ts` - Role: realtime projection; Purpose: delete field snapshots on remove.
- `ViewColumnMetaUpdatedRealtimeProjection.ts` - Role: realtime projection; Purpose: update View
  column meta, options, and persisted audit snapshots when a field is added/removed.
- `ViewCreatedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish an HTTP-compatible
  standalone View document including legacy filter/sort/group properties. View projections never
  touch the Table document: ShareDB serves it without `views[]`, so a mirror op would be dropped by
  every client and only fan out table list polls.
- `ViewDeletedRealtimeProjection.ts` - Role: realtime projection; Purpose: remove the deleted View
  document using its persisted version.
- `ViewDescriptionUpdatedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish View
  description and persisted audit metadata changes.
- `ViewFilterUpdatedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish View filter
  changes through the shared coalesced query-default projection.
- `ViewGroupUpdatedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish View group
  changes through the shared coalesced query-default projection.
- `ViewLockedUpdatedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish View lock
  state and persisted audit metadata changes.
- `ViewSortUpdatedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish legacy sort
  changes through the shared coalesced query-default projection.
- `ViewQueryDefaultsRealtimeProjection.ts` - Role: realtime projection helper; Purpose: coalesce one
  persisted filter/group/sort update into one versioned standalone View op, without a mirrored Table op.
- `ViewRealtimeProjectionUtils.ts` - Role: realtime projection helper; Purpose: build HTTP-compatible
  standalone View snapshots and append persisted audit fields without creating extra ops.
- `ViewManualSortAppliedRealtimeProjection.ts` - Role: realtime projection; Purpose: invalidate
  record collection queries after bulk row-order materialization commits.
- `ViewOptionsUpdatedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish
  type-specific View option and persisted audit metadata changes.
- `ViewOrderUpdatedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish the
  reordered View's order and persisted audit metadata on its standalone document.
- `ViewRenamedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish View name and
  persisted audit metadata changes.
- `ViewShareIdRefreshedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish the
  current credential and persisted audit metadata after share ID rotation.
- `ViewShareMetaUpdatedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish current
  View share and persisted audit metadata.
- `ViewShareStateRealtimeProjection.ts` - Role: realtime projection; Purpose: publish enable and
  disable share state plus persisted audit metadata through event-specific handlers.
