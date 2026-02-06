Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/fields/visitors Architecture Notes

## Responsibilities

- Field visitor interfaces and default implementations.
- Enable subtype-specific dispatch logic.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe field visitor role.
- `AbstractFieldVisitor.ts` - Role: abstract visitor; Purpose: base class with default lookup handling.
- `FieldCellValueSchemaVisitor.ts` - Role: visitor; Purpose: generate zod schema for cell value validation.
- `FieldCreationSideEffectVisitor.ts` - Role: visitor; Purpose: compute cross-table side effects for field creation.
- `FieldDeletionSideEffectVisitor.ts` - Role: visitor; Purpose: compute cross-table side effects for field deletion.
- `FieldDeletionSideEffectVisitor.spec.ts` - Role: tests; Purpose: verify delete side effects for link fields.
- `FieldFormVisibilityVisitor.ts` - Role: visitor; Purpose: decide form view visibility by field type.
- `FieldValueTypeVisitor.ts` - Role: visitor; Purpose: derive cell value types and multiplicity.
- `FieldValueTypeVisitor.spec.ts` - Role: tests; Purpose: verify value type visitor behavior.
- `IFieldVisitor.ts` - Role: visitor interface; Purpose: declare per-field visit methods.
- `NoopFieldVisitor.ts` - Role: no-op visitor; Purpose: default empty implementation.
- `SetFieldValueSpecFactoryVisitor.ts` - Role: visitor; Purpose: create SetValueSpec based on field type.

## Examples

- `packages/v2/core/src/ports/mappers/defaults/DefaultTableMapper.ts` - FieldVisitor implementation.
