Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/fields Architecture Notes

## Responsibilities

- Field entity base, field types, and field factory.
- Shared field abstractions and rehydrated value objects.

## Subfolders

- `types/` - Field subtypes and type-specific value objects.
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
- `visitors/FieldFormVisibilityVisitor.ts` - Role: visitor; Purpose: decide form view visibility by field type.

## Examples

- `packages/v2/core/src/domain/table/fields/FieldFactory.spec.ts` - Field creation.
- `packages/v2/core/src/domain/table/TableBuilder.ts` - Field builder usage.
