import type { IFieldVo } from '@teable/core';
import { CellValueType, assertNever, FieldType } from '@teable/core';
import { plainToInstance } from 'class-transformer';
import type { Doc } from 'sharedb/lib/client';
import { AttachmentField } from './attachment.field';
import { AutoNumberField } from './auto-number.field';
import { ButtonField } from './button.field';
import { CheckboxField } from './checkbox.field';
import { ConditionalRollupField } from './conditional-rollup.field';
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

const FIELD_TYPES = new Set<string>(Object.values(FieldType));

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asRecordObject = (value: unknown): Record<string, unknown> | undefined =>
  isRecordObject(value) ? value : undefined;

const isKnownFieldType = (value: unknown): value is FieldType =>
  typeof value === 'string' && FIELD_TYPES.has(value);

const inferLookupInnerType = (field: IFieldVo): FieldType => {
  switch (field.cellValueType) {
    case CellValueType.Number:
      return FieldType.Number;
    case CellValueType.DateTime:
      return FieldType.Date;
    case CellValueType.Boolean:
      return FieldType.Checkbox;
    default:
      return FieldType.SingleLineText;
  }
};

/**
 * Translate v2 lookup DTO shape (type: lookup/conditionalLookup) to the v1-compatible shape
 * consumed by the existing SDK field model.
 */
const normalizeV2LookupField = (field: IFieldVo): IFieldVo => {
  const rawType = (field as { type: string }).type;
  if (rawType !== 'lookup' && rawType !== 'conditionalLookup') {
    return field;
  }

  const raw = field as IFieldVo & {
    type: string;
    innerType?: unknown;
    innerOptions?: unknown;
    options?: unknown;
  };

  const rawOptions = asRecordObject(raw.options as unknown);
  const innerTypeCandidate =
    (typeof raw.innerType === 'string' ? raw.innerType : undefined) ||
    (typeof rawOptions?.innerType === 'string' ? rawOptions.innerType : undefined);
  const innerType = isKnownFieldType(innerTypeCandidate)
    ? innerTypeCandidate
    : inferLookupInnerType(field);

  const innerOptions = (raw.innerOptions ?? rawOptions?.innerOptions) as IFieldVo['options'];
  const condition = asRecordObject(rawOptions?.condition);

  const lookupOptions: Record<string, unknown> = {};
  if (rawOptions?.foreignTableId != null) lookupOptions.foreignTableId = rawOptions.foreignTableId;
  if (rawOptions?.lookupFieldId != null) lookupOptions.lookupFieldId = rawOptions.lookupFieldId;
  if (rawOptions?.linkFieldId != null) lookupOptions.linkFieldId = rawOptions.linkFieldId;
  if (rawOptions?.filter != null) lookupOptions.filter = rawOptions.filter;
  if (rawOptions?.sort != null) lookupOptions.sort = rawOptions.sort;
  if (rawOptions?.limit != null) lookupOptions.limit = rawOptions.limit;
  if (condition) {
    if (condition.filter !== undefined) lookupOptions.filter = condition.filter;
    if (condition.sort !== undefined) lookupOptions.sort = condition.sort;
    if (condition.limit !== undefined) lookupOptions.limit = condition.limit;
  }

  return {
    ...field,
    type: innerType,
    isLookup: true,
    isConditionalLookup:
      rawType === 'conditionalLookup' || field.isConditionalLookup ? true : undefined,
    options: innerOptions ?? {},
    lookupOptions:
      Object.keys(lookupOptions).length > 0
        ? (lookupOptions as IFieldVo['lookupOptions'])
        : field.lookupOptions,
  };
};

export function createFieldInstance(field: IFieldVo, doc?: Doc<IFieldVo>) {
  const normalizedField = normalizeV2LookupField(field);
  const instance = (() => {
    switch (normalizedField.type) {
      case FieldType.SingleLineText:
        return plainToInstance(SingleLineTextField, normalizedField);
      case FieldType.LongText:
        return plainToInstance(LongTextField, normalizedField);
      case FieldType.Number:
        return plainToInstance(NumberField, normalizedField);
      case FieldType.SingleSelect:
        return plainToInstance(SingleSelectField, normalizedField);
      case FieldType.MultipleSelect:
        return plainToInstance(MultipleSelectField, normalizedField);
      case FieldType.Link:
        return plainToInstance(LinkField, normalizedField);
      case FieldType.Formula:
        return plainToInstance(FormulaField, normalizedField);
      case FieldType.Attachment:
        return plainToInstance(AttachmentField, normalizedField);
      case FieldType.Date:
        return plainToInstance(DateField, normalizedField);
      case FieldType.Checkbox:
        return plainToInstance(CheckboxField, normalizedField);
      case FieldType.Rollup:
        return plainToInstance(RollupField, normalizedField);
      case FieldType.ConditionalRollup:
        return plainToInstance(ConditionalRollupField, normalizedField);
      case FieldType.Rating:
        return plainToInstance(RatingField, normalizedField);
      case FieldType.AutoNumber:
        return plainToInstance(AutoNumberField, normalizedField);
      case FieldType.CreatedTime:
        return plainToInstance(CreatedTimeField, normalizedField);
      case FieldType.LastModifiedTime:
        return plainToInstance(LastModifiedTimeField, normalizedField);
      case FieldType.User:
        return plainToInstance(UserField, normalizedField);
      case FieldType.CreatedBy:
        return plainToInstance(CreatedByField, normalizedField);
      case FieldType.LastModifiedBy:
        return plainToInstance(LastModifiedByField, normalizedField);
      case FieldType.Button:
        return plainToInstance(ButtonField, normalizedField);
      default:
        assertNever(normalizedField.type);
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
