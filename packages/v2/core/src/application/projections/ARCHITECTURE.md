Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# application/projections Architecture Notes

## Responsibilities

- Define projection types that bind Domain Events to derived effects.
- Provide an alias decorator for projection event bindings.
- Keep projections as EventHandlers (no event type branching inside handlers).

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe projection scope.
- `Projection.ts` - Role: projection alias; Purpose: define IProjection and the ProjectionHandler decorator.
- `RealtimeProjection.ts` - Role: marker type; Purpose: label projections that target realtime engines.
- `TableCreatedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish table snapshots on create.
- `FieldCreatedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish field snapshots on create.
- `FieldDeletedRealtimeProjection.ts` - Role: realtime projection; Purpose: delete field snapshots on remove.
- `ViewColumnMetaUpdatedRealtimeProjection.ts` - Role: realtime projection; Purpose: update View
  column meta, options, and persisted audit snapshots when a field is added/removed.
- `ViewCreatedRealtimeProjection.ts` - Role: realtime projection; Purpose: append the created View to
  the Table document and publish an HTTP-compatible standalone document including legacy
  filter/sort/group properties.
- `ViewDeletedRealtimeProjection.ts` - Role: realtime projection; Purpose: refresh the Table View list
  and remove the deleted View document using its persisted version.
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
  persisted filter/group/sort update into one versioned Table op and one versioned standalone View op.
- `ViewRealtimeProjectionUtils.ts` - Role: realtime projection helper; Purpose: build HTTP-compatible
  standalone View snapshots and append persisted audit fields without creating extra ops.
- `ViewManualSortAppliedRealtimeProjection.ts` - Role: realtime projection; Purpose: invalidate
  record collection queries after bulk row-order materialization commits.
- `ViewOptionsUpdatedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish
  type-specific View option and persisted audit metadata changes.
- `ViewOrderUpdatedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish the complete
  Table View ordering and persisted audit metadata after a reorder.
- `ViewRenamedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish View name and
  persisted audit metadata changes.
- `ViewShareIdRefreshedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish the
  current credential and persisted audit metadata after share ID rotation.
- `ViewShareMetaUpdatedRealtimeProjection.ts` - Role: realtime projection; Purpose: publish current
  View share and persisted audit metadata.
- `ViewShareStateRealtimeProjection.ts` - Role: realtime projection; Purpose: publish enable and
  disable share state plus persisted audit metadata through event-specific handlers.
