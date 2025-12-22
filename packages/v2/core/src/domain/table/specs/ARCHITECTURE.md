Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/specs Architecture Notes

## Responsibilities

- Table-specific specs and spec builder.
- Used for in-memory filtering and persistence translation.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe table spec system.
- `TableByBaseIdSpec.ts` - Role: spec; Purpose: filter by BaseId.
- `TableByIdSpec.ts` - Role: spec; Purpose: filter by TableId.
- `TableByNameLikeSpec.ts` - Role: spec; Purpose: fuzzy match by name.
- `TableByNameSpec.ts` - Role: spec; Purpose: exact match by name.
- `TableSpecBuilder.spec.ts` - Role: spec builder tests; Purpose: verify and/or/not composition.
- `TableSpecBuilder.ts` - Role: spec builder; Purpose: fluent table spec construction.
- `TableSpecs.spec.ts` - Role: spec tests; Purpose: verify isSatisfiedBy per spec.

## Examples

- `packages/v2/core/src/domain/table/specs/TableSpecBuilder.spec.ts` - Spec composition.
