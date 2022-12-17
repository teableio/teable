import { SingleSelectField } from '@teable-group/core';
import { DbFieldType } from '../constant';

export class SingleSelectFieldExtended extends SingleSelectField {
  get dbFieldType() {
    return DbFieldType.Text;
  }
}
