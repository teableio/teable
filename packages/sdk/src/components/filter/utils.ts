import { FieldType } from '@teable-group/core';
import { cloneDeep } from 'lodash';
import { operatorLabelMapping, fieldNumberLabelMap } from './constant';

const getFieldOperatorMapping = (type?: FieldType) => {
  let mergedMapping = cloneDeep(operatorLabelMapping);
  if (type === FieldType.Number) {
    mergedMapping = { ...operatorLabelMapping, ...fieldNumberLabelMap };
  }
  return mergedMapping;
};

export { getFieldOperatorMapping };
