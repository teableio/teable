import { assertNever } from '../../asserts';
import { FieldType } from './constant';
import {
  singlelineTextFieldOptionsSchema,
  numberFieldOptionsSchema,
  selectFieldOptionsSchema,
  dateFieldOptionsSchema,
  attachmentFieldOptionsSchema,
  linkFieldOptionsSchema,
  userFieldOptionsSchema,
  checkboxFieldOptionsSchema,
  ratingFieldOptionsSchema,
  formulaFieldOptionsSchema,
  autoNumberFieldOptionsSchema,
  createdTimeFieldOptionsSchema,
  lastModifiedTimeFieldOptionsSchema,
  createdByFieldOptionsSchema,
  lastModifiedByFieldOptionsSchema,
  longTextFieldOptionsSchema,
  rollupFieldOptionsSchema,
  buttonFieldOptionsSchema,
} from './derivate';

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
    case FieldType.Button:
      return buttonFieldOptionsSchema.safeParse(value);
    default:
      assertNever(fieldType);
  }
}
