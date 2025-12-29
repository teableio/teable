Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/records Architecture Notes

## Responsibilities

- Record entity and value objects for table data.
- Keep record field values keyed by FieldId.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe record domain types.
- `RecordId.ts` - Role: value object; Purpose: validate/generate record IDs.
- `TableRecord.ts` - Role: entity; Purpose: represent a table record with fields.
- `TableRecordFields.ts` - Role: value object; Purpose: store field-value pairs and cell value wrappers.

## Examples

- `packages/v2/core/src/domain/table/records/TableRecord.ts` - Record entity creation.
