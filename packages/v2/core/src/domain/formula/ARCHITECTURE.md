Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/formula Architecture Notes

## Responsibilities

- Formula parsing/type inference helpers used by domain value objects.
- Provide function registry metadata for return type inference (no evaluation).

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe formula helpers.
- `CellValueType.ts` - Role: enum; Purpose: formula cell value types.
- `FormulaFieldReference.ts` - Role: type; Purpose: referenced field type metadata.
- `function-aliases.ts` - Role: helper; Purpose: normalize function aliases.
- `functions/` - Role: function registry; Purpose: validate params + return types.
- `typed-value.ts` - Role: helper; Purpose: typed value container.
- `typed-value-converter.ts` - Role: helper; Purpose: normalize param types.
- `visitor.ts` - Role: visitor; Purpose: infer expression return types.

## Examples

- `packages/v2/core/src/domain/table/fields/types/FormulaExpression.ts` - Expression parsing + type inference.
