import { SingleLineTextField } from '@teable-group/core';
import { DbFieldType } from '../constant';

export class SingleLineTextModel extends SingleLineTextField {
  get dbFieldType() {
    return DbFieldType.Text;
  }
}
