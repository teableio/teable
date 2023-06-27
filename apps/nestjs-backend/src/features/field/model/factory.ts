/* eslint-disable sonarjs/no-duplicated-branches */
import type { LookupOptionsVo } from '@teable-group/core';
import {
  formatFieldErrorMessage,
  DbFieldType,
  assertNever,
  CellValueType,
  FieldType,
  generateFieldId,
} from '@teable-group/core';
import type { Field } from '@teable-group/db-main-prisma';
import { plainToInstance } from 'class-transformer';
import { isString } from 'lodash';
import type { CreateFieldRo } from './create-field.ro';
import { AttachmentFieldDto } from './field-dto/attachment-field.dto';
import { DateFieldDto } from './field-dto/date-field.dto';
import { FormulaFieldDto } from './field-dto/formula-field.dto';
import { LinkFieldDto } from './field-dto/link-field.dto';
import { MultipleSelectFieldDto } from './field-dto/multiple-select-field.dto';
import { NumberFieldDto } from './field-dto/number-field.dto';
import { SingleLineTextFieldDto } from './field-dto/single-line-text-field.dto';
import { SingleSelectFieldDto } from './field-dto/single-select-field.dto';
import type { FieldVo } from './field.vo';

export interface IPreparedRo {
  cellValueType: CellValueType;
  isLookup?: boolean;
  lookupOptions?: LookupOptionsVo;
}

function validateFieldByKey(key: string, fieldInstance: IFieldInstance) {
  switch (key) {
    case 'name':
    case 'description':
    case 'type':
      return { success: true };
    case 'defaultValue': {
      const res = fieldInstance.validateDefaultValue();
      return {
        success: res.success,
        error: res.success ? null : formatFieldErrorMessage(res.error),
      };
    }
    case 'options': {
      const res = fieldInstance.validateOptions();
      return {
        success: res.success,
        error: res.success ? null : formatFieldErrorMessage(res.error),
      };
    }
    default:
      return {
        success: false,
        error: 'The name field in the field does not support checksum',
      };
  }
}

export function createFieldInstanceByRo(createFieldRo: CreateFieldRo) {
  // generate Id first
  const fieldRo = createFieldRo.id ? createFieldRo : { ...createFieldRo, id: generateFieldId() };

  const instance = (() => {
    switch (createFieldRo.type) {
      case FieldType.SingleLineText:
        return SingleLineTextFieldDto.factory(fieldRo);
      case FieldType.Number:
        return NumberFieldDto.factory(fieldRo);
      case FieldType.SingleSelect:
        return SingleSelectFieldDto.factory(fieldRo);
      case FieldType.MultipleSelect:
        return MultipleSelectFieldDto.factory(fieldRo);
      case FieldType.Link:
        return LinkFieldDto.factory(fieldRo);
      case FieldType.Formula:
        return FormulaFieldDto.factory(fieldRo);
      case FieldType.Attachment:
        return AttachmentFieldDto.factory(fieldRo);
      case FieldType.Date:
        return DateFieldDto.factory(fieldRo);
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
      case FieldType.Checkbox:
      case FieldType.Rollup:
        return plainToInstance(SingleLineTextFieldDto, {
          ...fieldRo,
          type: FieldType.SingleLineText,
          isComputed: false,
          cellValueType: CellValueType.String,
          dbFieldType: DbFieldType.Text,
        } as SingleLineTextFieldDto);
      default:
        assertNever(createFieldRo.type);
    }
  })();

  const validateKeys = ['name', 'description', 'type', 'options', 'defaultValue'];

  const validateErrors = validateKeys
    .map((key) => validateFieldByKey(key, instance))
    .map((res) => res.error)
    .filter(isString);

  if (validateErrors.length > 0) {
    throw new Error(validateErrors.join('\n'));
  }
  return instance;
}

export function rawField2FieldObj(fieldRaw: Field): FieldVo {
  return {
    id: fieldRaw.id,
    dbFieldName: fieldRaw.dbFieldName,
    name: fieldRaw.name,
    type: fieldRaw.type as FieldType,
    description: fieldRaw.description || undefined,
    options: fieldRaw.options && JSON.parse(fieldRaw.options as string),
    notNull: fieldRaw.notNull || undefined,
    unique: fieldRaw.unique || undefined,
    isComputed: fieldRaw.isComputed || undefined,
    isPrimary: fieldRaw.isPrimary || undefined,
    isLookup: Boolean(fieldRaw.lookupFieldId) || undefined,
    lookupOptions: fieldRaw.lookupOptions && JSON.parse(fieldRaw.lookupOptions as string),
    defaultValue: fieldRaw.defaultValue && JSON.parse(fieldRaw.defaultValue as string),
    cellValueType: fieldRaw.cellValueType as CellValueType,
    isMultipleCellValue: fieldRaw.isMultipleCellValue || undefined,
    dbFieldType: fieldRaw.dbFieldType as DbFieldType,
    columnMeta: fieldRaw.columnMeta && JSON.parse(fieldRaw.columnMeta as string),
  };
}

export function createFieldInstanceByRaw(fieldRaw: Field) {
  return createFieldInstanceByVo(rawField2FieldObj(fieldRaw));
}

export function createFieldInstanceByVo(field: FieldVo) {
  switch (field.type) {
    case FieldType.SingleLineText:
      return plainToInstance(SingleLineTextFieldDto, field);
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
    case FieldType.Checkbox:
    case FieldType.Rollup:
      throw new Error('did not implement yet');
    default:
      assertNever(field.type);
  }
}

export type IFieldInstance = ReturnType<typeof createFieldInstanceByVo>;
