Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/shared/pagination Architecture Notes

## Responsibilities

- Offset/limit pagination value objects and composition.
- Keep pagination parameters valid inside the domain.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe pagination value objects.
- `OffsetPagination.ts` - Role: composite; Purpose: combine PageLimit and PageOffset.
- `PageLimit.ts` - Role: value object; Purpose: validate pagination limit.
- `PageOffset.ts` - Role: value object; Purpose: validate pagination offset.
- `Pagination.spec.ts` - Role: tests; Purpose: verify pagination validation.

## Examples

- `packages/v2/core/src/queries/ListTablesQuery.ts` - Pagination construction.
