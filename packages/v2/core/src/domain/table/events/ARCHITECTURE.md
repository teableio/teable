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

## Examples

- `packages/v2/core/src/domain/table/Table.ts` - TableCreated emission location.
- `packages/v2/core/src/domain/table/Table.ts` - TableDeleted emission location.
