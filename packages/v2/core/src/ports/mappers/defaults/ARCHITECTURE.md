Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# ports/mappers/defaults Architecture Notes

## Responsibilities

- Built-in default mapper for Table persistence DTO <-> domain.
- Uses Field/View visitors to map subtypes.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe default mapper role.
- `DefaultTableMapper.spec.ts` - Role: mapper tests; Purpose: validate DTO <-> domain conversions.
- `DefaultTableMapper.ts` - Role: default mapper; Purpose: map table/field/view between DTO and domain.
- `index.spec.ts` - Role: export tests; Purpose: validate entry exports.
- `index.ts` - Role: module entry; Purpose: export default mapper.

## Examples

- `packages/v2/core/src/ports/mappers/defaults/DefaultTableMapper.spec.ts` - Mapping round-trip example.
