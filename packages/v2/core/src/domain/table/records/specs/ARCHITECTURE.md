Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/records/specs Architecture Notes

## Responsibilities

- Define record condition operators and values.
- Model record query conditions as specifications with field-aware visitors.
- Provide a spec builder for and/or/not composition.

## Subfolders

- `visitors/` - Visitor interfaces and default no-op implementations.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe record condition specs.
- `RecordConditionOperators.ts` - Role: operators; Purpose: define operators, date modes, and field-operator compatibility.
- `RecordConditionValues.ts` - Role: value objects; Purpose: wrap literals, lists, date modes, and field references.
- `RecordConditionSpec.ts` - Role: spec base; Purpose: common condition spec behavior and evaluation helpers.
- `RecordConditionSpecBuilder.ts` - Role: spec builder; Purpose: compose condition specs with and/or/not groups.
- `FieldConditionSpecBuilder.ts` - Role: field spec builder; Purpose: validate operator/value compatibility and create specs per field.
- `RecordConditionSpecFactory.ts` - Role: spec factory; Purpose: delegate spec creation via field-level builder.
- `SingleLineTextConditionSpec.ts` - Role: spec; Purpose: text conditions for single line fields.
- `LongTextConditionSpec.ts` - Role: spec; Purpose: text conditions for long text fields.
- `ButtonConditionSpec.ts` - Role: spec; Purpose: text conditions for button fields.
- `NumberConditionSpec.ts` - Role: spec; Purpose: number conditions for numeric fields.
- `RatingConditionSpec.ts` - Role: spec; Purpose: number conditions for rating fields.
- `CheckboxConditionSpec.ts` - Role: spec; Purpose: boolean conditions for checkbox fields.
- `DateConditionSpec.ts` - Role: spec; Purpose: date/time conditions for date fields.
- `SingleSelectConditionSpec.ts` - Role: spec; Purpose: conditions for single select fields.
- `MultipleSelectConditionSpec.ts` - Role: spec; Purpose: conditions for multiple select fields.
- `AttachmentConditionSpec.ts` - Role: spec; Purpose: empty/not-empty checks for attachments.
- `UserConditionSpec.ts` - Role: spec; Purpose: user conditions with single/multiple operators.
- `LinkConditionSpec.ts` - Role: spec; Purpose: link conditions including contains.
- `FormulaConditionSpec.ts` - Role: spec; Purpose: computed field conditions for formulas.
- `RollupConditionSpec.ts` - Role: spec; Purpose: computed field conditions for rollups.
- `ITableRecordConditionSpecVisitor.ts` - Role: visitor interface; Purpose: per-condition visit hooks for translation.

## Examples

- `packages/v2/core/src/domain/table/records/specs/RecordConditionSpecBuilder.ts` - Composing record condition specs.
- `packages/v2/core/src/domain/table/records/specs/FieldConditionSpecBuilder.ts` - Operator validation and field-level spec creation.
