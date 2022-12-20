import type { INumberField, ISingleLineTextField, ISingleSelectField } from '@teable-group/core';
import { assertNever, FieldType, generateFieldId } from '@teable-group/core';
import type { CreateFieldDto } from '../create-field.dto';
import { NumberFieldExtended } from './number.field';
import { SingleLineTextFieldExtended } from './single-line-text.field';
import { SingleSelectFieldExtended } from './single-select.field';

export function createFieldInstance(createFieldDto: CreateFieldDto) {
  // generate Id first
  const fieldDto = { ...createFieldDto, id: generateFieldId() };

  switch (createFieldDto.type) {
    case FieldType.SingleLineText:
      return new SingleLineTextFieldExtended(fieldDto as ISingleLineTextField);
    case FieldType.Number:
      return new NumberFieldExtended(fieldDto as INumberField);
    case FieldType.SingleSelect:
      return new SingleSelectFieldExtended(fieldDto as ISingleSelectField);
    case FieldType.Attachment:
    case FieldType.Button:
    case FieldType.CreatedBy:
    case FieldType.Email:
    case FieldType.LastModifiedBy:
    case FieldType.LongText:
    case FieldType.MultipleSelect:
    case FieldType.PhoneNumber:
    case FieldType.URL:
    case FieldType.User:
    case FieldType.AutoNumber:
    case FieldType.Count:
    case FieldType.CreatedTime:
    case FieldType.Date:
    case FieldType.Duration:
    case FieldType.LastModifiedTime:
    case FieldType.Rating:
    case FieldType.Currency:
    case FieldType.Percent:
    case FieldType.Checkbox:
    case FieldType.Formula:
    case FieldType.Rollup:
    case FieldType.MultipleLookupValues:
    case FieldType.MultipleRecordLinks:
      throw new Error('did not implement yet');
    default:
      assertNever(createFieldDto.type);
  }
}

export type IFieldInstance = ReturnType<typeof createFieldInstance>;
