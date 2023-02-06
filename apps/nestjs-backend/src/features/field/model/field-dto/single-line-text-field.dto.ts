import { SingleLineTextField } from '@teable-group/core';
import type { DbFieldType } from '../../constant';

export class SingleLineTextFieldDto extends SingleLineTextField {
  dbFieldType!: DbFieldType.Text;
}
