import { assertNever } from '../../asserts';
import { FieldType } from './constant';
import { selectFieldOptionsSchema } from './derivate/abstract/select-option.schema';
import { attachmentFieldOptionsSchema } from './derivate/attachment-option.schema';
import { autoNumberFieldOptionsSchema } from './derivate/auto-number-option.schema';
import { buttonFieldOptionsSchema } from './derivate/button-option.schema';
import { checkboxFieldOptionsSchema } from './derivate/checkbox-option.schema';
import { conditionalRollupFieldOptionsSchema } from './derivate/conditional-rollup-option.schema';
import { createdByFieldOptionsSchema } from './derivate/created-by-option.schema';
import { createdTimeFieldOptionsSchema } from './derivate/created-time-option.schema';
import { dateFieldOptionsSchema } from './derivate/date-option.schema';
import { formulaFieldOptionsSchema } from './derivate/formula-option.schema';
import { lastModifiedByFieldOptionsSchema } from './derivate/last-modified-by-option.schema';
import { lastModifiedTimeFieldOptionsSchema } from './derivate/last-modified-time-option.schema';
import { linkFieldOptionsSchema } from './derivate/link-option.schema';
import { longTextFieldOptionsSchema } from './derivate/long-text-option.schema';
import { numberFieldOptionsSchema } from './derivate/number-option.schema';
import { ratingFieldOptionsSchema } from './derivate/rating-option.schema';
import { rollupFieldOptionsSchema } from './derivate/rollup-option.schema';
import { singlelineTextFieldOptionsSchema } from './derivate/single-line-text-option.schema';
import { userFieldOptionsSchema } from './derivate/user-option.schema';

export function safeParseOptions(fieldType: FieldType, value: unknown) {
  switch (fieldType) {
    case FieldType.SingleLineText:
      return singlelineTextFieldOptionsSchema.safeParse(value);
    case FieldType.LongText:
      return longTextFieldOptionsSchema.safeParse(value);
    case FieldType.Number:
      return numberFieldOptionsSchema.safeParse(value);
    case FieldType.SingleSelect:
      return selectFieldOptionsSchema.safeParse(value);
    case FieldType.MultipleSelect:
      return selectFieldOptionsSchema.safeParse(value);
    case FieldType.Date:
      return dateFieldOptionsSchema.safeParse(value);
    case FieldType.Attachment:
      return attachmentFieldOptionsSchema.safeParse(value);
    case FieldType.Link:
      return linkFieldOptionsSchema.safeParse(value);
    case FieldType.User:
      return userFieldOptionsSchema.safeParse(value);
    case FieldType.Checkbox:
      return checkboxFieldOptionsSchema.safeParse(value);
    case FieldType.Rating:
      return ratingFieldOptionsSchema.safeParse(value);
    case FieldType.Formula:
      return formulaFieldOptionsSchema.safeParse(value);
    case FieldType.AutoNumber:
      return autoNumberFieldOptionsSchema.safeParse(value);
    case FieldType.CreatedTime:
      return createdTimeFieldOptionsSchema.safeParse(value);
    case FieldType.LastModifiedTime:
      return lastModifiedTimeFieldOptionsSchema.safeParse(value);
    case FieldType.CreatedBy:
      return createdByFieldOptionsSchema.safeParse(value);
    case FieldType.LastModifiedBy:
      return lastModifiedByFieldOptionsSchema.safeParse(value);
    case FieldType.Rollup:
      return rollupFieldOptionsSchema.safeParse(value);
    case FieldType.ConditionalRollup:
      return conditionalRollupFieldOptionsSchema.safeParse(value);
    case FieldType.Button:
      return buttonFieldOptionsSchema.safeParse(value);
    default:
      assertNever(fieldType);
  }
}
