/* eslint-disable @typescript-eslint/naming-convention */
import type { IUserCellValue, ILinkCellValue, IOperator } from '@teable/core';
import {
  FieldType,
  isNot,
  is,
  isNotEmpty,
  exactDate,
  hasNoneOf,
  CellValueType,
} from '@teable/core';
import { zonedTimeToUtc } from 'date-fns-tz';
import type { IFieldInstance } from '../features/field/model/factory';

const SPECIAL_OPERATOR_FIELD_TYPE_SET = new Set([
  FieldType.MultipleSelect,
  FieldType.User,
  FieldType.CreatedBy,
  FieldType.LastModifiedBy,
  FieldType.Link,
]);

export const shouldFilterByDefaultValue = (
  field: { type: FieldType; cellValueType: CellValueType } | undefined
) => {
  if (!field) return false;

  const { type, cellValueType } = field;
  return (
    type === FieldType.Checkbox ||
    (type === FieldType.Formula && cellValueType === CellValueType.Boolean)
  );
};

export const cellValue2FilterValue = (cellValue: unknown, field: IFieldInstance) => {
  const { type, isMultipleCellValue } = field;

  if (
    cellValue == null ||
    ![FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy, FieldType.Link].includes(type)
  )
    return cellValue;

  if (isMultipleCellValue) {
    return (cellValue as (IUserCellValue | ILinkCellValue)[])?.map((v) => v.id);
  }
  return (cellValue as IUserCellValue | ILinkCellValue).id;
};

export const generateFilterItem = (field: IFieldInstance, value: unknown) => {
  let operator: IOperator = isNot.value;
  const { id: fieldId, type, isMultipleCellValue, options } = field;

  if (shouldFilterByDefaultValue(field)) {
    operator = is.value;
    value = !value || null;
  } else if (value == null) {
    operator = isNotEmpty.value;
  } else if (type === FieldType.Date) {
    const timeZone =
      options?.formatting?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dateStr = zonedTimeToUtc(value as string, timeZone).toISOString();
    value = {
      exactDate: dateStr,
      mode: exactDate.value,
      timeZone,
    };
  } else if (SPECIAL_OPERATOR_FIELD_TYPE_SET.has(type) && isMultipleCellValue) {
    operator = hasNoneOf.value;
  }

  return {
    fieldId,
    value: cellValue2FilterValue(value, field) as never,
    operator,
  };
};
