Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# application/projections Architecture Notes

## Responsibilities

- Define projection types that bind Domain Events to derived effects.
- Provide an alias decorator for projection event bindings.
- Keep projections as EventHandlers (no event type branching inside handlers).

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe projection scope.
- `DurableProjection.ts` - Role: durable projection decorator; Purpose: opt-in at-least-once consumers with stable ids.
- `SameTxProjection.ts` - Role: same-tx projection decorator; Purpose: run host projections inside the record write transaction.
- `recordProjectionCodecs.ts` - Role: record event codecs; Purpose: encode/decode immutable outbox DTOs.
- `Projection.ts` - Role: projection alias; Purpose: define IProjection and the ProjectionHandler decorator.
- `RealtimeProjection.ts` - Role: marker type; Purpose: label projections that target realtime engines.
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
