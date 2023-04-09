import type { IFieldVo, IFieldSnapshot } from '@teable-group/core';
import { assertNever, FieldType } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import { plainToInstance } from 'class-transformer';
import { NumberField } from './number.field';
import { SingleLineTextField } from './single-line-text.field';
import { SingleSelectField } from './single-select.field';

export function createFieldInstance(field: IFieldVo, doc?: Doc<IFieldSnapshot>) {
  const instance = (() => {
    switch (field.type) {
      case FieldType.SingleLineText:
        return plainToInstance(SingleLineTextField, field);
      case FieldType.Number:
        return plainToInstance(NumberField, field);
      case FieldType.SingleSelect:
        return plainToInstance(SingleSelectField, field);
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
        return plainToInstance(SingleLineTextField, { ...field, type: FieldType.SingleLineText });
      default:
        assertNever(field.type);
    }
  })();

  // force inject object into instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const temp: any = instance;
  temp.doc = doc;

  return instance;
}

export type IFieldInstance = ReturnType<typeof createFieldInstance>;
