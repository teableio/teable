import type { IDateFieldOptions, ILinkCellValue, IOperator, IUserCellValue } from '@teable/core';
import { exactDate, FieldType, is, isEmpty, isExactly } from '@teable/core';
import type { IFieldInstance } from '@teable/sdk/model';
import { UNCATEGORIZED_STACK_ID } from '../constant';
import type { IStackData } from '../type';

export const getFilterValue = (stackField: IFieldInstance, stackData: unknown) => {
  const { type, isMultipleCellValue, options } = stackField;

  if (stackData == null) return stackData;
  if (
    [FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy, FieldType.Link].includes(type)
  ) {
    return isMultipleCellValue
      ? (stackData as (IUserCellValue | ILinkCellValue)[])?.map((v) => v.id)
      : (stackData as IUserCellValue | ILinkCellValue).id;
  }
  if (type === FieldType.SingleSelect || type === FieldType.MultipleSelect) {
    return isMultipleCellValue ? (stackData as string[]) : (stackData as string);
  }
  if ([FieldType.Date, FieldType.CreatedTime, FieldType.LastModifiedTime].includes(type)) {
    const timeZone =
      (options as IDateFieldOptions)?.formatting?.timeZone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone;
    return {
      exactDate: stackData,
      mode: exactDate.value,
      timeZone,
    };
  }
  return stackData;
};

export const getFilterSet = (stackField: IFieldInstance, stack: IStackData) => {
  const { id: fieldId, type, isMultipleCellValue } = stackField;
  const { id: stackId, data: stackData } = stack;
  const isUncategorized = stackId === UNCATEGORIZED_STACK_ID;
  const filterValue = getFilterValue(stackField, stackData);
  let operator: IOperator = is.value;

  if (isUncategorized && type !== FieldType.Checkbox) {
    operator = isEmpty.value;
  } else if (isMultipleCellValue) {
    operator = isExactly.value;
  }

  return [
    {
      fieldId,
      operator,
      value: (isUncategorized ? null : filterValue) as string | null,
    },
  ];
};
