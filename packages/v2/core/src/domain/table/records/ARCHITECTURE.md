Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/records Architecture Notes

## Responsibilities

- Record entity and value objects for table data.
- Keep record field values keyed by FieldId.
- Define record condition specs for querying and future persistence translation.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe record domain types.
- `RecordId.ts` - Role: value object; Purpose: validate/generate record IDs.
- `TableRecord.ts` - Role: entity; Purpose: represent a table record with fields.
- `TableRecordFields.ts` - Role: value object; Purpose: store field-value pairs and cell value wrappers.
- `specs/ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe record condition specs.
- `specs/RecordConditionSpecBuilder.ts` - Role: spec builder; Purpose: compose record conditions with and/or/not.
- `specs/FieldConditionSpecBuilder.ts` - Role: field spec builder; Purpose: create validated specs per field.
- `specs/ITableRecordConditionSpecVisitor.ts` - Role: visitor interface; Purpose: per-condition visit hooks.

## Examples

- `packages/v2/core/src/domain/table/records/TableRecord.ts` - Record entity creation.
- `packages/v2/core/src/domain/table/records/specs/RecordConditionSpecBuilder.ts` - Record condition composition.
