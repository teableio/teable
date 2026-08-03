Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/events Architecture Notes

## Responsibilities

- Table domain events.
- Used for cross-boundary publication and audit.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe table events.
- `TableCreated.ts` - Role: domain event; Purpose: payload for table creation.
- `TableDeleted.ts` - Role: domain event; Purpose: payload for table deletion.
- `TableRenamed.ts` - Role: domain event; Purpose: payload for table rename.
- `FieldCreated.ts` - Role: domain event; Purpose: payload for field creation.
- `FieldDeleted.ts` - Role: domain event; Purpose: payload for field deletion.
- `ViewColumnMetaUpdated.ts` - Role: domain event; Purpose: payload for view column meta update when field is added/removed.

## Examples

- `packages/v2/core/src/domain/table/Table.ts` - TableCreated emission location.
- `packages/v2/core/src/domain/table/Table.ts` - TableDeleted emission location.
- `packages/v2/core/src/domain/table/Table.ts` - FieldCreated emission location.
- `packages/v2/core/src/domain/table/Table.ts` - FieldDeleted emission location.
- `packages/v2/core/src/domain/table/Table.ts` - ViewColumnMetaUpdated emission location (addField, removeField).
