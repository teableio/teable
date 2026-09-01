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
- `ViewAuditMetadata.ts` - Role: value object; Purpose: preserve View creation and modification
  attribution.
- `ViewBasics.spec.ts` - Role: view tests; Purpose: verify view basics.
- `ViewColumnMeta.ts` - Role: value object; Purpose: validate and build view column meta.
- `ViewFactory.ts` - Role: factory; Purpose: create view subtypes.
- `ViewGroup.ts` - Role: value object; Purpose: validate and preserve grouped field configuration.
- `ViewId.ts` - Role: value object; Purpose: ViewId validation and generation.
- `ViewName.ts` - Role: value object; Purpose: ViewName validation and wrapping.
- `ViewOptions.ts` - Role: domain validation; Purpose: validate type-specific options during View creation.
- `ViewOrder.ts` - Role: value object; Purpose: validate and preserve aggregate-relative View order.
- `ViewProperties.ts` - Role: value object; Purpose: immutable description, lock, and share creation properties.
- `ViewQueryDefaults.ts` - Role: value object; Purpose: immutable canonical filter, sort, group, and manual-sort defaults.
- `ViewSnapshot.ts` - Role: domain snapshot; Purpose: capture and safely replay View state for v2
  undo and redo without restoring revoked share credentials.
- `ViewSort.ts` - Role: value object; Purpose: validate and preserve the public nullable View sort
  payload while mapping it to query defaults.
- `ViewSourceFilter.ts` - Role: compatibility value object; Purpose: validate and preserve the public View filter while deriving its canonical v2 form.
- `ViewType.spec.ts` - Role: value object tests; Purpose: verify ViewType validation.
- `ViewType.ts` - Role: value object; Purpose: view type enum wrapper.
- `ViewVersion.ts` - Role: value object; Purpose: enforce non-negative optimistic View versions.

## Examples

- `packages/v2/core/src/domain/table/views/ViewBasics.spec.ts` - View construction.
