import type { IFieldVo } from '@teable-group/core';
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
import { RatingField } from './rating.field';
import { RollupField } from './rollup.field';
import { SingleLineTextField } from './single-line-text.field';
import { SingleSelectField } from './single-select.field';

export function createFieldInstance(field: IFieldVo, doc?: Doc<IFieldVo>) {
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
      case FieldType.Rollup:
        return plainToInstance(RollupField, field);
      case FieldType.Rating:
        return plainToInstance(RatingField, field);
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
      case FieldType.Currency:
      case FieldType.Percent:
        return plainToInstance(SingleLineTextField, { ...field, type: FieldType.SingleLineText });
      default:
        assertNever(field.type);
    }
  })();

  // force inject object into instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const temp: any = instance;
  temp.doc = doc;
  temp.tableId = doc?.collection.split('_')[1];

  return instance;
}

export type IFieldInstance = ReturnType<typeof createFieldInstance>;
