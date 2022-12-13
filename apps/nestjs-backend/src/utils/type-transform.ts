import { assertNever, FieldType } from '@teable-group/core';
import { DbFieldType } from '../constant/field';

export function getDbFieldTypeByFieldType(type: FieldType) {
  switch (type) {
    case FieldType.Attachment:
    case FieldType.Button:
    case FieldType.CreatedBy:
    case FieldType.Email:
    case FieldType.LastModifiedBy:
    case FieldType.LongText:
    case FieldType.MultipleSelect:
    case FieldType.PhoneNumber:
    case FieldType.SingleLineText:
    case FieldType.SingleSelect:
    case FieldType.URL:
    case FieldType.User:
      return DbFieldType.Text;
    case FieldType.Autonumber:
    case FieldType.Count:
    case FieldType.CreatedTime:
    case FieldType.Date:
    case FieldType.Duration:
    case FieldType.LastModifiedTime:
    case FieldType.Rating:
      return DbFieldType.Integer;
    case FieldType.Currency:
    case FieldType.Number:
    case FieldType.Percent:
      return DbFieldType.Real;
    case FieldType.Checkbox:
      return DbFieldType.Blob;
    case FieldType.Formula:
    case FieldType.Rollup:
    case FieldType.Lookup:
      throw new Error('did not implement yet');
    default:
      assertNever(type);
  }
}
