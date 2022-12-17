import { NumberField } from '@teable-group/core';
import { DbFieldType } from '../constant';

export class NumberFieldExtended extends NumberField {
  get dbFieldType() {
    return DbFieldType.Real;
  }
}
