Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/records/values Architecture Notes

## Responsibilities

- Generic CellValue Value Object for wrapping validated cell values.
- Type-safe representation of cell values after validation.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe cell value types.
- `CellValue.ts` - Role: value object; Purpose: generic wrapper for validated cell values.

## Design Notes

- `CellValue<T>` is a generic Value Object that wraps validated values
- Values should be validated via `FieldCellValueSchemaVisitor` before creating CellValue
- Supports null values for nullable fields
- Used by SetValueSpec classes to hold the value to be set
