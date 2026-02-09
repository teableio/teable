Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/shared/sort Architecture Notes

## Responsibilities

- Sort field and direction modeling.
- Shared sorting contract for repositories.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe sort model.
- `Sort.spec.ts` - Role: tests; Purpose: verify sort composition and validation.
- `Sort.ts` - Role: sort model; Purpose: combine sort key and direction.
- `SortDirection.ts` - Role: value object; Purpose: validate sort direction.

## Examples

- `packages/v2/core/src/queries/ListTablesQuery.ts` - Sort construction.
