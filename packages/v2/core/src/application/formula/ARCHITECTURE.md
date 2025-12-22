Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# application/formula Architecture Notes

## Responsibilities

- Application-level orchestration for formula fields (dependency resolution and type inference).

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe formula application helpers.
- `resolveFormulaFields.ts` - Role: application helper; Purpose: compute dependencies, detect cycles, set formula result types.

## Examples

- `packages/v2/core/src/commands/CreateTableHandler.ts` - Formula resolution during table creation.
