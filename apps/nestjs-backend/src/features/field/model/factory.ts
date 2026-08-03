import type {
  IFieldVo,
  DbFieldType,
  CellValueType,
  ISetFieldPropertyOpContext,
  FieldCore,
} from '@teable/core';
import { assertNever, FieldType, applyFieldPropertyOps } from '@teable/core';
import type { Field } from '@teable/db-main-prisma';
import { instanceToPlain, plainToInstance } from 'class-transformer';
import { AttachmentFieldDto } from './field-dto/attachment-field.dto';
import { AutoNumberFieldDto } from './field-dto/auto-number-field.dto';
import { ButtonFieldDto } from './field-dto/button-field.dto';
import { CheckboxFieldDto } from './field-dto/checkbox-field.dto';
import { ConditionalRollupFieldDto } from './field-dto/conditional-rollup-field.dto';
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

// eslint-disable-next-line sonarjs/cognitive-complexity
export function rawField2FieldObj(fieldRaw: Field): IFieldVo {
  let options = fieldRaw.options && JSON.parse(fieldRaw.options as string);
  if (
    fieldRaw.type === FieldType.Link &&
    options &&
    typeof options === 'object' &&
    (options as { isOneWay?: boolean }).isOneWay === true
  ) {
    delete (options as { symmetricFieldId?: string }).symmetricFieldId;
  }

  if (fieldRaw.isLookup && options == null) {
    options = {};
  }

  return {
    id: fieldRaw.id,
    dbFieldName: fieldRaw.dbFieldName,
    name: fieldRaw.name,
    type: fieldRaw.type as FieldType,
    description: fieldRaw.description || undefined,
    options,
    meta: (fieldRaw.meta && JSON.parse(fieldRaw.meta as string)) || undefined,
    aiConfig: (fieldRaw.aiConfig && JSON.parse(fieldRaw.aiConfig as string)) || undefined,
    notNull: fieldRaw.notNull || undefined,
    unique: fieldRaw.unique ?? false,
    isComputed: fieldRaw.isComputed || undefined,
    isPrimary: fieldRaw.isPrimary || undefined,
    isPending: fieldRaw.isPending || undefined,
    isLookup: fieldRaw.isLookup || undefined,
    isConditionalLookup: fieldRaw.isConditionalLookup || undefined,
    hasError: fieldRaw.hasError || undefined,
    lookupOptions:
      (fieldRaw.lookupOptions && JSON.parse(fieldRaw.lookupOptions as string)) || undefined,
    cellValueType: fieldRaw.cellValueType as CellValueType,
    isMultipleCellValue: fieldRaw.isMultipleCellValue ?? undefined,
    dbFieldType: fieldRaw.dbFieldType as DbFieldType,
  };
}

export function fieldCore2FieldInstance(field: FieldCore): IFieldInstance {
  const plain: IFieldVo = {
    id: field.id,
    dbFieldName: field.dbFieldName,
    name: field.name,
    type: field.type,
    description: field.description,
    options: { ...(field.options as object) },
    meta: field.meta ? { ...field.meta } : undefined,
    aiConfig: field.aiConfig ? { ...field.aiConfig } : undefined,
    notNull: field.notNull,
    unique: field.unique,
    isComputed: field.isComputed,
    isPrimary: field.isPrimary,
    isPending: field.isPending,
    isLookup: field.isLookup,
    isConditionalLookup: field.isConditionalLookup,
    hasError: field.hasError,
    lookupOptions: field.lookupOptions ? { ...field.lookupOptions } : undefined,
    cellValueType: field.cellValueType,
    isMultipleCellValue: field.isMultipleCellValue,
    dbFieldType: field.dbFieldType,
    recordRead: field.recordRead,
    recordCreate: field.recordCreate,
  };

  return createFieldInstanceByVo(plain);
}

export function createFieldInstanceByRaw(fieldRaw: Field) {
  return createFieldInstanceByVo(rawField2FieldObj(fieldRaw));
}

const normalizeConditionalLookupFieldVo = (field: IFieldVo): IFieldVo => {
  if (field.type !== ('conditionalLookup' as FieldType)) {
    return field;
  }

  const options =
    field.options && typeof field.options === 'object' && !Array.isArray(field.options)
      ? (field.options as Record<string, unknown>)
      : {};
  const innerTypeRaw = options.innerType;
  const innerOptionsRaw = options.innerOptions;
  const innerType =
    typeof innerTypeRaw === 'string' ? (innerTypeRaw as FieldType) : FieldType.SingleLineText;
  const innerOptions =
    innerOptionsRaw && typeof innerOptionsRaw === 'object' && !Array.isArray(innerOptionsRaw)
      ? (innerOptionsRaw as Record<string, unknown>)
      : {};

  return {
    ...field,
    type: innerType,
    options: innerOptions,
    isLookup: true,
    isConditionalLookup: true,
  };
};

export function createFieldInstanceByVo(field: IFieldVo) {
  const normalizedField = normalizeConditionalLookupFieldVo(field);
  switch (normalizedField.type) {
    case FieldType.SingleLineText:
      return plainToInstance(SingleLineTextFieldDto, normalizedField);
    case FieldType.LongText:
      return plainToInstance(LongTextFieldDto, normalizedField);
    case FieldType.Number:
      return plainToInstance(NumberFieldDto, normalizedField);
    case FieldType.SingleSelect:
      return plainToInstance(SingleSelectFieldDto, normalizedField);
    case FieldType.MultipleSelect:
      return plainToInstance(MultipleSelectFieldDto, normalizedField);
    case FieldType.Link:
      return plainToInstance(LinkFieldDto, normalizedField);
    case FieldType.Formula:
      return plainToInstance(FormulaFieldDto, normalizedField);
    case FieldType.Attachment:
      return plainToInstance(AttachmentFieldDto, normalizedField);
    case FieldType.Date:
      return plainToInstance(DateFieldDto, normalizedField);
    case FieldType.Checkbox:
      return plainToInstance(CheckboxFieldDto, normalizedField);
    case FieldType.Rollup:
      return plainToInstance(RollupFieldDto, normalizedField);
    case FieldType.ConditionalRollup:
      return plainToInstance(ConditionalRollupFieldDto, normalizedField);
    case FieldType.Rating:
      return plainToInstance(RatingFieldDto, normalizedField);
    case FieldType.AutoNumber:
      return plainToInstance(AutoNumberFieldDto, normalizedField);
    case FieldType.CreatedTime:
      return plainToInstance(CreatedTimeFieldDto, normalizedField);
    case FieldType.LastModifiedTime:
      return plainToInstance(LastModifiedTimeFieldDto, normalizedField);
    case FieldType.User:
      return plainToInstance(UserFieldDto, normalizedField);
    case FieldType.CreatedBy:
      return plainToInstance(CreatedByFieldDto, normalizedField);
    case FieldType.LastModifiedBy:
      return plainToInstance(LastModifiedByFieldDto, normalizedField);
    case FieldType.Button:
      return plainToInstance(ButtonFieldDto, normalizedField);
    default:
      assertNever(normalizedField.type);
  }
}

export type IFieldInstance = ReturnType<typeof createFieldInstanceByVo>;

export interface IFieldMap {
  [fieldId: string]: IFieldInstance;
}

export function convertFieldInstanceToFieldVo(fieldInstance: IFieldInstance): IFieldVo {
  return instanceToPlain(fieldInstance, { excludePrefixes: ['_'] }) as IFieldVo;
}

/**
 * Apply field property operations to a field VO and return a field instance.
 * This function combines the pure applyFieldPropertyOps function with createFieldInstanceByVo.
 *
 * @param fieldVo - The existing field VO to base the new field on
 * @param ops - Array of field property operations to apply
 * @returns A new field instance with the operations applied
 */
export function applyFieldPropertyOpsAndCreateInstance(
  fieldVo: IFieldVo,
  ops: ISetFieldPropertyOpContext[]
): IFieldInstance {
  // Apply operations to get a new field VO
  const newFieldVo = applyFieldPropertyOps(fieldVo, ops);

  // Create and return a field instance from the modified VO
  return createFieldInstanceByVo(newFieldVo);
}
