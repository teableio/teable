Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/fields Architecture Notes

## Responsibilities

- Field entity base, field types, and field factory.
- Shared field abstractions and rehydrated value objects.
- Includes system/computed fields (created time/by, last modified time/by, auto number).

## Subfolders

- `specs/` - Field specifications and builder.
- `types/` - Field subtypes and type-specific value objects (computed/not-null/unique flags).
- `visitors/` - Field visitor interfaces and defaults.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe field abstractions.
- `DbFieldName.ts` - Role: rehydrated value object; Purpose: persisted field name.
- `Field.ts` - Role: field base; Purpose: shared field behavior + visitor entry.
- `FieldBasics.spec.ts` - Role: field tests; Purpose: verify base field behavior.
- `FieldFactory.spec.ts` - Role: factory tests; Purpose: cover field creation branches.
- `FieldFactory.ts` - Role: field factory; Purpose: create field subtypes.
- `FieldId.ts` - Role: value object; Purpose: FieldId validation and generation.
- `FieldName.ts` - Role: value object; Purpose: FieldName validation and wrapping.
- `FieldType.ts` - Role: value object; Purpose: field type enumeration wrapper.
- `ForeignTableRelatedField.ts` - Role: interface + helper; Purpose: validate cross-table references in field types.
- `ForeignTableValidation.spec.ts` - Role: tests; Purpose: cover rollup foreign table validation.
- `specs/ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe field specifications.
- `visitors/FieldCreationSideEffectVisitor.ts` - Role: visitor; Purpose: compute cross-table side effects for field creation.
- `visitors/FieldDeletionSideEffectVisitor.ts` - Role: visitor; Purpose: compute cross-table side effects for field deletion.
- `visitors/FieldFormVisibilityVisitor.ts` - Role: visitor; Purpose: decide form view visibility by field type.
- `visitors/LinkForeignTableReferenceVisitor.ts` - Role: visitor; Purpose: collect foreign table references from link fields.
- `fieldPredicates.ts` - Role: functional utils; Purpose: predicates to check field types

## Examples

- `packages/v2/core/src/domain/table/fields/FieldFactory.spec.ts` - Field creation.
- `packages/v2/core/src/domain/table/TableBuilder.ts` - Field builder usage.
