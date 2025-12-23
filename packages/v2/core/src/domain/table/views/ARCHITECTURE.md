Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/views Architecture Notes

## Responsibilities

- View entity base and view type definitions.
- View column meta defaults and validation.
- Provide ViewFactory as a unified creation entry.

## Subfolders

- `types/` - View subtypes.
- `visitors/` - View visitor interfaces and defaults.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe view abstractions.
- `View.ts` - Role: view base; Purpose: shared view behavior + visitor entry.
- `ViewBasics.spec.ts` - Role: view tests; Purpose: verify view basics.
- `ViewColumnMeta.ts` - Role: value object; Purpose: validate and build view column meta.
- `ViewFactory.ts` - Role: factory; Purpose: create view subtypes.
- `ViewId.ts` - Role: value object; Purpose: ViewId validation and generation.
- `ViewName.ts` - Role: value object; Purpose: ViewName validation and wrapping.
- `ViewType.spec.ts` - Role: value object tests; Purpose: verify ViewType validation.
- `ViewType.ts` - Role: value object; Purpose: view type enum wrapper.

## Examples

- `packages/v2/core/src/domain/table/views/ViewBasics.spec.ts` - View construction.
