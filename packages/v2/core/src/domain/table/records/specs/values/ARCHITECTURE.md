Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/records/specs/values Architecture Notes

## Responsibilities

- Cell value mutation specifications for record field updates.
- Visitor interface for transforming specs into persistence operations.
- Each SetValueSpec represents a "set field value" operation for a specific field type.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe cell value spec patterns.
- `ICellValueSpecVisitor.ts` - Role: visitor interface; Purpose: visit cell value specs.
- `SetSingleLineTextValueSpec.ts` - Role: spec; Purpose: set single line text field value.
- `SetLongTextValueSpec.ts` - Role: spec; Purpose: set long text field value.
- `SetNumberValueSpec.ts` - Role: spec; Purpose: set number field value.
- `SetRatingValueSpec.ts` - Role: spec; Purpose: set rating field value.
- `SetSingleSelectValueSpec.ts` - Role: spec; Purpose: set single select field value.
- `SetMultipleSelectValueSpec.ts` - Role: spec; Purpose: set multiple select field value.
- `SetCheckboxValueSpec.ts` - Role: spec; Purpose: set checkbox field value.
- `SetDateValueSpec.ts` - Role: spec; Purpose: set date field value.
- `SetAttachmentValueSpec.ts` - Role: spec; Purpose: set attachment field value.
- `SetLinkValueSpec.ts` - Role: spec; Purpose: set link field value.
- `SetUserValueSpec.ts` - Role: spec; Purpose: set user field value.

## Design Notes

- All SetValueSpec classes extend `MutateOnlySpec<TableRecord, ICellValueSpecVisitor>`
- `mutate(record)` updates the record in memory via `record.setFieldValue()`
- `accept(visitor)` allows repository adapters to transform specs into SQL operations
- Multiple specs can be combined using `andSpec()` for batch updates
- Future: `IncrementNumberValueSpec` and other operation types can be added

## Usage Flow

### Insert (current)

1. Create specs for each field value
2. Combine with `andSpec()`
3. Call `spec.mutate(record)` to build the record in memory
4. Repository serializes the complete record

### Update (future)

1. Create specs for fields to update
2. Repository calls `spec.accept(visitor)` to collect column/value pairs
3. Generate UPDATE SQL from visitor results
