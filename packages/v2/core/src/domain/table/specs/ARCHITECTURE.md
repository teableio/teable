Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/specs Architecture Notes

## Responsibilities

- Table-specific specs and spec builder.
- Used for in-memory filtering and persistence translation.
- Some specs double as mutate specs (e.g. `TableByNameSpec` for renames).
- `ITableSpecVisitor` defines table-specific visit hooks for where/update translation.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe table spec system.
- `ITableSpecVisitor.ts` - Role: visitor interface; Purpose: generic table-specific visit methods for query/update translation payloads.
- `TableAddFieldSpec.ts` - Role: mutate spec; Purpose: append a field to a table.
- `TableRemoveFieldSpec.ts` - Role: mutate spec; Purpose: remove a field from a table.
- `TableUpdateViewColumnMetaSpec.ts` - Role: mutate spec; Purpose: carry view column meta updates during table mutations.
- `TableByBaseIdSpec.ts` - Role: spec; Purpose: filter by BaseId.
- `TableByIdSpec.ts` - Role: spec; Purpose: filter by TableId.
- `TableByIdsSpec.ts` - Role: spec; Purpose: filter by multiple TableIds.
- `TableByNameLikeSpec.ts` - Role: spec; Purpose: fuzzy match by name.
- `TableByNameSpec.ts` - Role: spec; Purpose: exact match by name.
- `TableSpecBuilder.spec.ts` - Role: spec builder tests; Purpose: verify and/or/not composition.
- `TableSpecBuilder.ts` - Role: spec builder; Purpose: fluent table spec construction.
- `TableSpecs.spec.ts` - Role: spec tests; Purpose: verify isSatisfiedBy per spec.

## Examples

- `packages/v2/core/src/domain/table/specs/TableSpecBuilder.spec.ts` - Spec composition.
