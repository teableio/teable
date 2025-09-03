import type { IFieldVo, DbFieldType, CellValueType } from '@teable/core';
import { assertNever, FieldType } from '@teable/core';
import type { Field } from '@teable/db-main-prisma';
import { instanceToPlain, plainToInstance } from 'class-transformer';
import { AttachmentFieldDto } from './field-dto/attachment-field.dto';
import { AutoNumberFieldDto } from './field-dto/auto-number-field.dto';
import { ButtonFieldDto } from './field-dto/button-field.dto';
import { CheckboxFieldDto } from './field-dto/checkbox-field.dto';
import { CreatedByFieldDto } from './field-dto/created-by-field.dto';
import { CreatedTimeFieldDto } from './field-dto/created-time-field.dto';
import { DateFieldDto } from './field-dto/date-field.dto';
import { FormulaFieldDto } from './field-dto/formula-field.dto';
import { LastModifiedByFieldDto } from './field-dto/last-modified-by-field.dto';
import { LastModifiedTimeFieldDto } from './field-dto/last-modified-time-field.dto';
import { LinkFieldDto } from './field-dto/link-field.dto';
import { LongTextFieldDto } from './field-dto/long-text-field.dto';
import { MultipleSelectFieldDto } from './field-dto/multiple-select-field.dto';
import { NumberFieldDto } from './field-dto/number-field.dto';
import { RatingFieldDto } from './field-dto/rating-field.dto';
import { RollupFieldDto } from './field-dto/rollup-field.dto';
import { SingleLineTextFieldDto } from './field-dto/single-line-text-field.dto';
import { SingleSelectFieldDto } from './field-dto/single-select-field.dto';
import { UserFieldDto } from './field-dto/user-field.dto';

export function rawField2FieldObj(fieldRaw: Field): IFieldVo {
  return {
    id: fieldRaw.id,
    dbFieldName: fieldRaw.dbFieldName,
    name: fieldRaw.name,
    type: fieldRaw.type as FieldType,
    description: fieldRaw.description || undefined,
    options: fieldRaw.options && JSON.parse(fieldRaw.options as string),
    aiConfig: (fieldRaw.aiConfig && JSON.parse(fieldRaw.aiConfig as string)) || undefined,
    notNull: fieldRaw.notNull || undefined,
    unique: fieldRaw.unique || undefined,
    isComputed: fieldRaw.isComputed || undefined,
    isPrimary: fieldRaw.isPrimary || undefined,
    isPending: fieldRaw.isPending || undefined,
    isLookup: fieldRaw.isLookup || undefined,
    hasError: fieldRaw.hasError || undefined,
    lookupOptions:
      (fieldRaw.lookupOptions && JSON.parse(fieldRaw.lookupOptions as string)) || undefined,
    cellValueType: fieldRaw.cellValueType as CellValueType,
    isMultipleCellValue: fieldRaw.isMultipleCellValue || undefined,
    dbFieldType: fieldRaw.dbFieldType as DbFieldType,
  };
}

export function createFieldInstanceByRaw(fieldRaw: Field) {
  return createFieldInstanceByVo(rawField2FieldObj(fieldRaw));
}

export function createFieldInstanceByVo(field: IFieldVo) {
  switch (field.type) {
    case FieldType.SingleLineText:
      return plainToInstance(SingleLineTextFieldDto, field);
    case FieldType.LongText:
      return plainToInstance(LongTextFieldDto, field);
    case FieldType.Number:
      return plainToInstance(NumberFieldDto, field);
    case FieldType.SingleSelect:
      return plainToInstance(SingleSelectFieldDto, field);
    case FieldType.MultipleSelect:
      return plainToInstance(MultipleSelectFieldDto, field);
    case FieldType.Link:
      return plainToInstance(LinkFieldDto, field);
    case FieldType.Formula:
      return plainToInstance(FormulaFieldDto, field);
    case FieldType.Attachment:
      return plainToInstance(AttachmentFieldDto, field);
    case FieldType.Date:
      return plainToInstance(DateFieldDto, field);
    case FieldType.Checkbox:
      return plainToInstance(CheckboxFieldDto, field);
    case FieldType.Rollup:
      return plainToInstance(RollupFieldDto, field);
    case FieldType.Rating:
      return plainToInstance(RatingFieldDto, field);
    case FieldType.AutoNumber:
      return plainToInstance(AutoNumberFieldDto, field);
    case FieldType.CreatedTime:
      return plainToInstance(CreatedTimeFieldDto, field);
    case FieldType.LastModifiedTime:
      return plainToInstance(LastModifiedTimeFieldDto, field);
    case FieldType.User:
      return plainToInstance(UserFieldDto, field);
    case FieldType.CreatedBy:
      return plainToInstance(CreatedByFieldDto, field);
    case FieldType.LastModifiedBy:
      return plainToInstance(LastModifiedByFieldDto, field);
    case FieldType.Button:
      return plainToInstance(ButtonFieldDto, field);
    default:
      assertNever(field.type);
  }
}

export type IFieldInstance = ReturnType<typeof createFieldInstanceByVo>;

export interface IFieldMap {
  [fieldId: string]: IFieldInstance;
}

export function convertFieldInstanceToFieldVo(fieldInstance: IFieldInstance): IFieldVo {
  return instanceToPlain(fieldInstance, { excludePrefixes: ['_'] }) as IFieldVo;
}
