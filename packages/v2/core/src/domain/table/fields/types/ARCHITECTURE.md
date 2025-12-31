Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/fields/types Architecture Notes

## Responsibilities

- Field subtypes and type-specific value objects/config.
- Validate with ValueObject + Result and expose serialization helpers.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe field subtypes and value objects.
- `AttachmentField.ts` - Role: field subtype; Purpose: attachment field entity.
- `AutoNumberField.ts` - Role: field subtype; Purpose: system auto-number field entity.
- `ButtonField.ts` - Role: field subtype; Purpose: button field entity.
- `ButtonLabel.ts` - Role: value object; Purpose: button label validation.
- `ButtonMaxCount.ts` - Role: value object; Purpose: max click count config.
- `ButtonResetCount.ts` - Role: value object; Purpose: reset count config.
- `ButtonWorkflow.ts` - Role: value object; Purpose: workflow linkage config.
- `CheckboxDefaultValue.ts` - Role: value object; Purpose: checkbox default.
- `CheckboxField.ts` - Role: field subtype; Purpose: checkbox field entity.
- `CreatedByField.ts` - Role: field subtype; Purpose: system created-by field entity.
- `CreatedTimeField.ts` - Role: field subtype; Purpose: system created-time field entity.
- `DateDefaultValue.ts` - Role: value object; Purpose: date default config.
- `DateField.ts` - Role: field subtype; Purpose: date field entity.
- `DateFormat.spec.ts` - Role: value object tests; Purpose: validate date formats.
- `DateFormat.ts` - Role: value object; Purpose: date format enum wrapper.
- `DateTimeFormatting.spec.ts` - Role: value object tests; Purpose: validate date/time formatting.
- `DateTimeFormatting.ts` - Role: value object; Purpose: date/time/timezone formatting.
- `FieldColor.ts` - Role: value object; Purpose: field color enum wrapper.
- `FieldComputed.ts` - Role: value object; Purpose: computed field flag.
- `FieldNotNull.ts` - Role: value object; Purpose: not-null validation flag.
- `FieldUnique.ts` - Role: value object; Purpose: uniqueness validation flag.
- `FormulaExpression.ts` - Role: value object; Purpose: formula expression parsing + type inference.
- `FormulaField.ts` - Role: field subtype; Purpose: formula field entity.
- `FormulaMeta.ts` - Role: value object; Purpose: formula persistence meta (rehydrated).
- `LastModifiedByField.ts` - Role: field subtype; Purpose: system last-modified-by field entity.
- `LastModifiedTimeField.ts` - Role: field subtype; Purpose: system last-modified-time field entity.
- `LinkField.ts` - Role: field subtype; Purpose: link field entity.
- `LinkField.spec.ts` - Role: field tests; Purpose: verify link field lookup behavior.
- `LinkFieldMeta.ts` - Role: value object; Purpose: link field meta config.
- `LinkFieldConfig.ts` - Role: value object; Purpose: link field relationship config.
- `LinkRelationship.ts` - Role: value object; Purpose: link relationship type.
- `FieldTypes.spec.ts` - Role: type tests; Purpose: verify field subtype creation.
- `FieldValueObjects.spec.ts` - Role: value object tests; Purpose: verify field value objects.
- `LongTextField.ts` - Role: field subtype; Purpose: long text field entity.
- `MultipleSelectField.ts` - Role: field subtype; Purpose: multiple select field entity.
- `CellValueMultiplicity.ts` - Role: value object; Purpose: single/multiple cell multiplicity.
- `CellValueType.ts` - Role: value object; Purpose: formula result type wrapper.
- `NumberDefaultValue.ts` - Role: value object; Purpose: number default config.
- `NumberField.ts` - Role: field subtype; Purpose: number field entity.
- `NumberFormatting.spec.ts` - Role: value object tests; Purpose: validate number formatting.
- `NumberFormatting.ts` - Role: value object; Purpose: number formatting config.
- `NumberShowAs.spec.ts` - Role: value object tests; Purpose: validate number display config.
- `NumberShowAs.ts` - Role: value object; Purpose: number display config.
- `NumericPrecision.spec.ts` - Role: value object tests; Purpose: validate precision rules.
- `NumericPrecision.ts` - Role: value object; Purpose: numeric precision config.
- `RatingColor.ts` - Role: value object; Purpose: rating color config.
- `RatingField.ts` - Role: field subtype; Purpose: rating field entity.
- `RatingIcon.ts` - Role: value object; Purpose: rating icon config.
- `RatingMax.ts` - Role: value object; Purpose: rating max value.
- `SelectAutoNewOptions.ts` - Role: value object; Purpose: auto-new option config.
- `SelectDefaultValue.ts` - Role: value object; Purpose: select default config.
- `SelectOption.ts` - Role: value object; Purpose: option id/name/color bundle.
- `SelectOptionId.ts` - Role: value object; Purpose: option ID validation.
- `SelectOptionName.ts` - Role: value object; Purpose: option name validation.
- `SelectOptions.ts` - Role: validation helper; Purpose: option uniqueness + default validation.
- `SingleLineTextField.ts` - Role: field subtype; Purpose: single-line text field entity.
- `SingleLineTextShowAs.spec.ts` - Role: value object tests; Purpose: validate showAs config.
- `SingleLineTextShowAs.ts` - Role: value object; Purpose: single-line display config.
- `SingleSelectField.ts` - Role: field subtype; Purpose: single select field entity.
- `TextDefaultValue.ts` - Role: value object; Purpose: text default config.
- `TimeZone.ts` - Role: constants; Purpose: timezone list.
- `UserDefaultValue.ts` - Role: value object; Purpose: user default config.
- `UserField.ts` - Role: field subtype; Purpose: user field entity.
- `UserId.ts` - Role: value object; Purpose: user ID validation.
- `UserMultiplicity.ts` - Role: value object; Purpose: multi-user config.
- `UserNotification.ts` - Role: value object; Purpose: notification config.

## Examples

- `packages/v2/core/src/domain/table/fields/FieldFactory.spec.ts` - Field construction.
- `packages/v2/core/src/domain/table/fields/types/FieldValueObjects.spec.ts` - Value object validation.
