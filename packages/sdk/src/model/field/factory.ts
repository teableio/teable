import type { IFieldSnapshot } from '@teable-group/core';
import { assertNever, FieldType } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import { plainToInstance } from 'class-transformer';
import { AttachmentField } from './attachment.field';
import { CheckboxField } from './checkbox.field';
import { DateField } from './date.field';
import { FormulaField } from './formula.field';
import { LinkField } from './link.field';
import { MultipleSelectField } from './multiple-select.field';
import { NumberField } from './number.field';
import { SingleLineTextField } from './single-line-text.field';
import { SingleSelectField } from './single-select.field';

export function createFieldInstance(fieldSnapshot: IFieldSnapshot, doc?: Doc<IFieldSnapshot>) {
  const field = fieldSnapshot.field;
  const instance = (() => {
    switch (field.type) {
      case FieldType.SingleLineText:
        return plainToInstance(SingleLineTextField, field);
      case FieldType.Number:
        return plainToInstance(NumberField, field);
      case FieldType.SingleSelect:
        return plainToInstance(SingleSelectField, field);
      case FieldType.MultipleSelect:
        return plainToInstance(MultipleSelectField, field);
      case FieldType.Link:
        return plainToInstance(LinkField, field);
      case FieldType.Formula:
        return plainToInstance(FormulaField, field);
      case FieldType.Attachment:
        return plainToInstance(AttachmentField, field);
      case FieldType.Date:
        return plainToInstance(DateField, field);
      case FieldType.Checkbox:
        return plainToInstance(CheckboxField, field);
      case FieldType.Button:
      case FieldType.CreatedBy:
      case FieldType.Email:
      case FieldType.LastModifiedBy:
      case FieldType.LongText:
      case FieldType.PhoneNumber:
      case FieldType.URL:
      case FieldType.User:
      case FieldType.AutoNumber:
      case FieldType.Count:
      case FieldType.CreatedTime:
      case FieldType.Duration:
      case FieldType.LastModifiedTime:
      case FieldType.Rating:
      case FieldType.Currency:
      case FieldType.Percent:
      case FieldType.Rollup:
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
