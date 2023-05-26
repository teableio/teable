/* eslint-disable sonarjs/no-duplicated-branches */
import type { LinkFieldOptions } from '@teable-group/core';
import {
  formatFieldErrorMessage,
  DbFieldType,
  assertNever,
  CellValueType,
  FieldType,
  generateFieldId,
  Relationship,
} from '@teable-group/core';
import type { Field } from '@teable-group/db-main-prisma';
import { plainToInstance } from 'class-transformer';
import { isString } from 'lodash';
import type { CreateFieldRo } from './create-field.ro';
import { FormulaFieldDto } from './field-dto/formula-field.dto';
import { LinkFieldDto } from './field-dto/link-field.dto';
import { MultipleSelectFieldDto } from './field-dto/multiple-select-field.dto';
import { NumberFieldDto } from './field-dto/number-field.dto';
import { SingleLineTextFieldDto } from './field-dto/single-line-text-field.dto';
import { SingleSelectFieldDto } from './field-dto/single-select-field.dto';
import type { FieldVo } from './field.vo';

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

export function createFieldInstanceByRo(createFieldRo: CreateFieldRo & { id?: string }) {
  // generate Id first
  const fieldDto = createFieldRo.id ? createFieldRo : { ...createFieldRo, id: generateFieldId() };

  const instance = (() => {
    switch (createFieldRo.type) {
      case FieldType.SingleLineText:
        return plainToInstance(SingleLineTextFieldDto, {
          ...fieldDto,
          isComputed: false,
          calculatedType: FieldType.SingleLineText,
          cellValueType: CellValueType.String,
          dbFieldType: DbFieldType.Text,
        } as SingleLineTextFieldDto);
      case FieldType.Number:
        return plainToInstance(NumberFieldDto, {
          ...fieldDto,
          isComputed: false,
          calculatedType: FieldType.Number,
          cellValueType: CellValueType.Number,
          dbFieldType: DbFieldType.Real,
        } as NumberFieldDto);
      case FieldType.SingleSelect:
        return plainToInstance(SingleSelectFieldDto, {
          ...fieldDto,
          isComputed: false,
          calculatedType: FieldType.SingleSelect,
          cellValueType: CellValueType.String,
          dbFieldType: DbFieldType.Text,
        } as SingleSelectFieldDto);
      case FieldType.MultipleSelect:
        return plainToInstance(MultipleSelectFieldDto, {
          ...fieldDto,
          isComputed: false,
          calculatedType: FieldType.MultipleSelect,
          cellValueType: CellValueType.Array,
          cellValueElementType: CellValueType.String,
          dbFieldType: DbFieldType.Text,
        } as MultipleSelectFieldDto);
      case FieldType.Link: {
        const options = fieldDto.options as LinkFieldOptions;

        return plainToInstance(LinkFieldDto, {
          ...fieldDto,
          isComputed: true,
          calculatedType: FieldType.Link,
          cellValueType:
            options.relationship === Relationship.ManyOne
              ? CellValueType.String
              : CellValueType.Array,
          cellValueElementType:
            options.relationship === Relationship.ManyOne ? undefined : CellValueType.String,
          dbFieldType: DbFieldType.Text,
        } as LinkFieldDto);
      }
      case FieldType.Formula: {
        return plainToInstance(FormulaFieldDto, {
          ...fieldDto,
          isComputed: true,
          calculatedType: FieldType.Formula,
          cellValueType: CellValueType.String,
          dbFieldType: DbFieldType.Text,
        } as FormulaFieldDto);
      }
      case FieldType.Attachment:
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
      case FieldType.Date:
      case FieldType.Duration:
      case FieldType.LastModifiedTime:
      case FieldType.Rating:
      case FieldType.Currency:
      case FieldType.Percent:
      case FieldType.Checkbox:
      case FieldType.Rollup:
      case FieldType.MultipleLookupValues:
        return plainToInstance(SingleLineTextFieldDto, {
          ...fieldDto,
          type: FieldType.SingleLineText,
          isComputed: false,
          calculatedType: FieldType.SingleLineText,
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

export function createFieldInstanceByRaw(fieldRaw: Field) {
  const field: FieldVo = {
    id: fieldRaw.id,
    name: fieldRaw.name,
    type: fieldRaw.type as FieldType,
    description: fieldRaw.description || undefined,
    options: fieldRaw.options && JSON.parse(fieldRaw.options as string),
    notNull: fieldRaw.notNull || undefined,
    unique: fieldRaw.unique || undefined,
    isComputed: fieldRaw.isComputed || undefined,
    isPrimary: fieldRaw.isPrimary || undefined,
    defaultValue: fieldRaw.defaultValue && JSON.parse(fieldRaw.defaultValue as string),
    calculatedType: fieldRaw.calculatedType as FieldType,
    cellValueType: fieldRaw.cellValueType as CellValueType,
    cellValueElementType: fieldRaw.cellValueElementType as CellValueType,
    dbFieldType: fieldRaw.dbFieldType as DbFieldType,
    columnMeta: fieldRaw.columnMeta && JSON.parse(fieldRaw.columnMeta as string),
  };

  return createFieldInstanceByVo(field);
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
    case FieldType.Date:
    case FieldType.Duration:
    case FieldType.LastModifiedTime:
    case FieldType.Rating:
    case FieldType.Currency:
    case FieldType.Percent:
    case FieldType.Checkbox:
    case FieldType.Rollup:
    case FieldType.MultipleLookupValues:
      throw new Error('did not implement yet');
    default:
      assertNever(field.type);
  }
}

export type IFieldInstance = ReturnType<typeof createFieldInstanceByVo>;
