import type { IFieldVo } from '@teable/core';
import { assertNever, FieldType } from '@teable/core';
import { plainToInstance } from 'class-transformer';
import type { Doc } from 'sharedb/lib/client';
import { AttachmentField } from './attachment.field';
import { AutoNumberField } from './auto-number.field';
import { ButtonField } from './button.field';
import { CheckboxField } from './checkbox.field';
import { CreatedByField } from './created-by.field';
import { CreatedTimeField } from './created-time.field';
import { DateField } from './date.field';
import { FormulaField } from './formula.field';
import { LastModifiedByField } from './last-modified-by.field';
import { LastModifiedTimeField } from './last-modified-time.field';
import { LinkField } from './link.field';
import { LongTextField } from './long-text.field';
import { MultipleSelectField } from './multiple-select.field';
import { NumberField } from './number.field';
import { RatingField } from './rating.field';
import { RollupField } from './rollup.field';
import { SingleLineTextField } from './single-line-text.field';
import { SingleSelectField } from './single-select.field';
import { UserField } from './user.field';

export function createFieldInstance(field: IFieldVo, doc?: Doc<IFieldVo>) {
  const instance = (() => {
    switch (field.type) {
      case FieldType.SingleLineText:
        return plainToInstance(SingleLineTextField, field);
      case FieldType.LongText:
        return plainToInstance(LongTextField, field);
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
      case FieldType.AutoNumber:
        return plainToInstance(AutoNumberField, field);
      case FieldType.CreatedTime:
        return plainToInstance(CreatedTimeField, field);
      case FieldType.LastModifiedTime:
        return plainToInstance(LastModifiedTimeField, field);
      case FieldType.User:
        return plainToInstance(UserField, field);
      case FieldType.CreatedBy:
        return plainToInstance(CreatedByField, field);
      case FieldType.LastModifiedBy:
        return plainToInstance(LastModifiedByField, field);
      case FieldType.Button:
        return plainToInstance(ButtonField, field);
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
