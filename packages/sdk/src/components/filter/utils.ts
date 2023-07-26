import { FieldType } from '@teable-group/core';
import { merge } from 'lodash';
import { operatorLabelMapping, fieldNumberLabelMap } from './constant';

const getFieldOperatorMapping = (type?: FieldType) => {
  let mergedMapping = operatorLabelMapping;
  if (type === FieldType.Number) {
    mergedMapping = merge(operatorLabelMapping, fieldNumberLabelMap);
  }
  return mergedMapping;
};

export { getFieldOperatorMapping };
