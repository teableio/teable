Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/fields/visitors Architecture Notes

## Responsibilities

- Field visitor interfaces and default implementations.
- Enable subtype-specific dispatch logic.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe field visitor role.
- `FieldCreationSideEffectVisitor.ts` - Role: visitor; Purpose: compute cross-table side effects for field creation.
- `FieldForeignTableValidationVisitor.ts` - Role: visitor; Purpose: validate cross-table references for link/rollup fields.
- `FieldFormVisibilityVisitor.ts` - Role: visitor; Purpose: decide form view visibility by field type.
- `FieldValueTypeVisitor.ts` - Role: visitor; Purpose: derive cell value types and multiplicity.
- `FieldValueTypeVisitor.spec.ts` - Role: tests; Purpose: verify value type visitor behavior.
- `IFieldVisitor.ts` - Role: visitor interface; Purpose: declare per-field visit methods.
- `NoopFieldVisitor.ts` - Role: no-op visitor; Purpose: default empty implementation.

## Examples

- `packages/v2/core/src/ports/mappers/defaults/DefaultTableMapper.ts` - FieldVisitor implementation.
