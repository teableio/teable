Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/base Architecture Notes

## Responsibilities

- Base domain value objects.
- Required ownership identifier for aggregates like Table.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe Base domain values.
- `BaseId.spec.ts` - Role: value object tests; Purpose: validate BaseId rules.
- `BaseId.ts` - Role: value object; Purpose: BaseId validation and generation.
- `optionalForeignBaseId.spec.ts` - Role: schema tests; Purpose: keep foreign baseId optional on table field input and cover parse/equality helpers.
- `optionalForeignBaseId.ts` - Role: shared schema and helpers; Purpose: treat empty/null foreign baseId as same-base, parse optional BaseId, and compare optional BaseIds.

## Examples

- `packages/v2/core/src/domain/table/Table.ts` - BaseId usage in Table aggregate.
