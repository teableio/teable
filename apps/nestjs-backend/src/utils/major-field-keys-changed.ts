/* eslint-disable @typescript-eslint/naming-convention */
import type { IFieldVo, IConvertFieldRo } from '@teable/core';
import { FIELD_RO_PROPERTIES } from '@teable/core';
import { isEqual, difference } from 'lodash';

export const NON_INFECT_OPTION_KEYS = new Set([
  'formatting',
  'showAs',
  'visibleFieldIds',
  'filterByViewId',
  'filter',
]);

export const majorOptionsKeyChanged = (
  oldOptions: Record<string, unknown>,
  newOptions: Record<string, unknown>
) => {
  const keys = Object.keys(newOptions).filter((key) => !isEqual(oldOptions[key], newOptions[key]));

  return keys.some((key) => !NON_INFECT_OPTION_KEYS.has(key));
};

export function majorFieldKeysChanged(oldField: IFieldVo, fieldRo: IConvertFieldRo) {
  const keys = FIELD_RO_PROPERTIES.filter((key) => !isEqual(fieldRo[key], oldField[key]));
  // filter property
  const majorKeys = difference(keys, ['name', 'description', 'dbFieldName']);

  if (!majorKeys.length) {
    return false;
  }

  // only non infect options changed
  if (majorKeys.length === 1 && majorKeys[0] === 'options') {
    const oldOptions = (oldField.options as Record<string, unknown>) || {};
    const newOptions = (fieldRo.options as Record<string, unknown>) || {};

    return majorOptionsKeyChanged(oldOptions, newOptions);
  }

  return true;
}
