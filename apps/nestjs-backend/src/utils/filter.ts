/* eslint-disable @typescript-eslint/naming-convention */
import type { IUserCellValue, ILinkCellValue, IOperator, IFieldVo } from '@teable/core';
import {
  FieldType,
  isNot,
  is,
  isNotEmpty,
  isNotExactly,
  CellValueType,
  exactFormatDate,
  buttonFieldCelValueSchema,
} from '@teable/core';
export type GroupFilterField = Pick<
  IFieldVo,
  'id' | 'type' | 'isMultipleCellValue' | 'options' | 'cellValueType'
>;

const SPECIAL_OPERATOR_FIELD_TYPE_SET = new Set([
  FieldType.SingleSelect,
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

export const cellValue2FilterValue = (cellValue: unknown, field: GroupFilterField) => {
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

export const generateFilterItem = (field: GroupFilterField, value: unknown) => {
  let operator: IOperator = isNot.value;
  const { id: fieldId, type, isMultipleCellValue, options, cellValueType } = field;

  if (shouldFilterByDefaultValue(field)) {
    operator = is.value;
    value = !value || null;
  } else if (value == null) {
    operator = isNotEmpty.value;
  } else if (type === FieldType.Button) {
    value = buttonFieldCelValueSchema.parse(value).count;
  } else if (
    type === FieldType.Date ||
    (type === FieldType.Formula && cellValueType === CellValueType.DateTime)
  ) {
    const formatting = options && 'formatting' in options ? options.formatting : undefined;
    const timeZone =
      formatting &&
      typeof formatting === 'object' &&
      'timeZone' in formatting &&
      typeof formatting.timeZone === 'string'
        ? formatting.timeZone
        : Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Group keys are already absolute instants (ISO with offset); re-zoning them
    // would shift by the server process timezone and exclude the wrong day.
    const dateStr = new Date(value as string).toISOString();
    value = {
      exactDate: dateStr,
      mode: exactFormatDate.value,
      timeZone,
    };
  } else if (SPECIAL_OPERATOR_FIELD_TYPE_SET.has(type) && isMultipleCellValue) {
    operator = isNotExactly.value;
  }

  return {
    fieldId,
    value: cellValue2FilterValue(value, field) as never,
    operator,
  };
};
