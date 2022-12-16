import { NumberField } from '@teable-group/core';
import { DbFieldType } from '../constant';

export class NumberModel extends NumberField {
  get dbFieldType() {
    return DbFieldType.Real;
  }
}
