import { SingleLineTextField } from '@teable-group/core';
import { DbFieldType } from '../constant';

export class SingleLineTextFieldExtended extends SingleLineTextField {
  get dbFieldType() {
    return DbFieldType.Text;
  }
}
