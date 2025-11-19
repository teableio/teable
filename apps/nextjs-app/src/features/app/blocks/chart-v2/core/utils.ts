import type { IFieldVo } from '@teable/core';
import { createFieldInstance } from '@teable/sdk/model';
import { get } from 'lodash';

export const getGroupUniqueKey = (value: unknown) => {
  if (value == null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === 'object') {
      return value.map((obj) => getObjectCellValueUniqueKey(obj)).join(',');
    }
    return value.join(',');
  }

  if (typeof value === 'object') {
    const objValue = value as Record<string, unknown>;
    return getObjectCellValueUniqueKey(objValue);
  }

  return String(value);
};

const getObjectCellValueUniqueKey = (value: Record<string, unknown>) => {
  return get(value, 'id') || get(value, 'title') || get(value, 'name');
};

export const getGroupKeyName = (field: IFieldVo, value: unknown) => {
  const fieldInstance = createFieldInstance(field);
  return fieldInstance.cellValue2String(value);
};
