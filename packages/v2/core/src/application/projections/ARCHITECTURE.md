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
- `ViewColumnMetaUpdatedRealtimeProjection.ts` - Role: realtime projection; Purpose: update view column meta snapshots when field is added/removed.
