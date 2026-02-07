Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# ports/mappers Architecture Notes

## Responsibilities

- Define domain <-> persistence DTO mapping contracts.
- Implemented by adapters; core provides defaults.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe mapper contracts.
- `TableMapper.ts` - Role: Table mapper port; Purpose: Table/Field/View DTO types + toDTO/toDomain.

## Examples

- `packages/v2/core/src/ports/mappers/defaults/DefaultTableMapper.ts` - Default mapper implementation.
