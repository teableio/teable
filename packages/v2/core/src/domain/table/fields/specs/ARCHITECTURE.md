Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/fields/specs Architecture Notes

## Responsibilities

- Field-level specifications and the builder for composing them.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe field spec structure.
- `FieldSpecBuilder.ts` - Role: builder; Purpose: compose field specifications.
- `FieldByIdSpec.ts` - Role: spec; Purpose: match fields by FieldId.
- `FieldByNameSpec.ts` - Role: spec; Purpose: match fields by FieldName.
- `FieldIsAttachmentSpec.ts` - Role: spec; Purpose: match attachment fields.
- `FieldIsBooleanValueSpec.ts` - Role: spec; Purpose: match boolean cell value fields.
- `FieldIsButtonSpec.ts` - Role: spec; Purpose: match button fields.
- `FieldIsCheckboxSpec.ts` - Role: spec; Purpose: match checkbox fields.
- `FieldIsComputedSpec.ts` - Role: spec; Purpose: match computed fields.
- `FieldIsDateSpec.ts` - Role: spec; Purpose: match date fields.
- `FieldIsDateLikeSpec.ts` - Role: spec; Purpose: match date-like fields via value type.
- `FieldIsDateTimeValueSpec.ts` - Role: spec; Purpose: match date-time cell value fields.
- `FieldIsFormulaSpec.ts` - Role: spec; Purpose: match formula fields.
- `FieldIsJsonSpec.ts` - Role: spec; Purpose: match json-backed fields.
- `FieldIsLinkSpec.ts` - Role: spec; Purpose: match link fields.
- `FieldIsLongTextSpec.ts` - Role: spec; Purpose: match long text fields.
- `FieldIsMultipleSelectSpec.ts` - Role: spec; Purpose: match multiple select fields.
- `FieldIsNumberFieldSpec.ts` - Role: spec; Purpose: match numeric field types (number/rating).
- `FieldIsNumberLikeSpec.ts` - Role: spec; Purpose: match number-like fields via value type.
- `FieldIsNumberValueSpec.ts` - Role: spec; Purpose: match number cell value fields.
- `FieldIsNumberSpec.ts` - Role: spec; Purpose: match number fields.
- `FieldIsPrimarySpec.ts` - Role: spec; Purpose: match the primary field by FieldId.
- `FieldIsRatingSpec.ts` - Role: spec; Purpose: match rating fields.
- `FieldIsRollupSpec.ts` - Role: spec; Purpose: match rollup fields.
- `FieldIsSingleSelectSpec.ts` - Role: spec; Purpose: match single select fields.
- `FieldIsSingleTextSpec.ts` - Role: spec; Purpose: match single-line text fields.
- `FieldIsStringValueSpec.ts` - Role: spec; Purpose: match string cell value fields.
- `FieldIsUserSpec.ts` - Role: spec; Purpose: match user fields.

## Examples

- `packages/v2/core/src/domain/table/fields/specs/FieldSpecBuilder.ts` - Spec composition.
