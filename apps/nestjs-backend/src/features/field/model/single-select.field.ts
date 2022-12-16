import { SingleSelectField } from '@teable-group/core';
import { DbFieldType } from '../constant';

export class SingleSelectModel extends SingleSelectField {
  get dbFieldType() {
    return DbFieldType.Text;
  }
}
