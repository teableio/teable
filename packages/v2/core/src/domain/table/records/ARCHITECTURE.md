Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/records Architecture Notes

## Responsibilities

- Record entity and value objects for table data.
- Keep record field values keyed by FieldId.
- Define record condition specs for querying and future persistence translation.
- Define cell value mutation specs for setting field values.
- Provide builder pattern for composing multiple field value changes.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe record domain types.
- `RecordId.ts` - Role: value object; Purpose: validate/generate record IDs.
- `TableRecord.ts` - Role: entity; Purpose: represent a table record with fields, supports setFieldValue mutation.
- `TableRecordFields.ts` - Role: value object; Purpose: store field-value pairs and cell value wrappers.
- `RecordMutationSpecBuilder.ts` - Role: builder; Purpose: compose multiple SetValueSpecs with andSpec.
- `values/CellValue.ts` - Role: value object; Purpose: generic wrapper for validated cell values.
- `values/ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe cell value types.
- `specs/ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe record condition specs.
- `specs/RecordConditionSpecBuilder.ts` - Role: spec builder; Purpose: compose record conditions with and/or/not.
- `specs/FieldConditionSpecBuilder.ts` - Role: field spec builder; Purpose: create validated specs per field.
- `specs/ITableRecordConditionSpecVisitor.ts` - Role: visitor interface; Purpose: per-condition visit hooks.
- `specs/values/ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe cell value mutation specs.
- `specs/values/ICellValueSpecVisitor.ts` - Role: visitor interface; Purpose: visit cell value specs.
- `specs/values/Set*ValueSpec.ts` - Role: specs; Purpose: set field values by type (text, number, etc.).
- `specs/values/SetFieldValueSpecFactory.ts` - Role: factory; Purpose: create SetValueSpecs with validation.

## Examples

- `packages/v2/core/src/domain/table/records/TableRecord.ts` - Record entity creation.
- `packages/v2/core/src/domain/table/records/specs/RecordConditionSpecBuilder.ts` - Record condition composition.
- `packages/v2/core/src/domain/table/records/RecordMutationSpecBuilder.ts` - Composing field value mutations.
