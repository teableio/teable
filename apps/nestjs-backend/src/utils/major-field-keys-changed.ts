import type { IFieldVo, IConvertFieldRo } from '@teable/core';
import { FIELD_RO_PROPERTIES } from '@teable/core';
import { isEqual, difference } from 'lodash';

export function majorFieldKeysChanged(oldField: IFieldVo, fieldRo: IConvertFieldRo) {
  const keys = FIELD_RO_PROPERTIES.filter((key) => !isEqual(fieldRo[key], oldField[key]));
  // filter property
  const majorKeys = difference(keys, ['name', 'description', 'dbFieldName']);

  if (!majorKeys.length) {
    return false;
  }

  // only formatting or showAs changed
  if (majorKeys.length === 1 && majorKeys[0] === 'options') {
    const oldOptions = (oldField.options as Record<string, unknown>) || {};
    const newOptions = (fieldRo.options as Record<string, unknown>) || {};

    const keys = Object.keys(newOptions).filter(
      (key) => !isEqual(oldOptions[key], newOptions[key])
    );

    return keys.some((key) => !['formatting', 'showAs'].includes(key));
  }

  return true;
}
