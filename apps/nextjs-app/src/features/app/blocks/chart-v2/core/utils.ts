import { getFieldRollupKey, type IFieldVo } from '@teable/core';
import { DEFAULT_SERIES_ARRAY, type IStatisticFieldItem } from '@teable/openapi';
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

export const getFieldRollupKeyByFieldName = (fields: IFieldVo[], name: string, rollup: string) => {
  const field = fields.find((field) => field.name === name);

  if (!field) {
    return null;
  }

  return getFieldRollupKey(field.id, rollup);
};

export const isCountAllSeries = (
  seriesArray: IStatisticFieldItem[] | string
): seriesArray is string => {
  if (typeof seriesArray === 'string') {
    return seriesArray === DEFAULT_SERIES_ARRAY;
  }
  return false;
};
