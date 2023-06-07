import { SingleLineTextFieldCore } from '@teable-group/core';
import type { IFieldBase } from '../field-base';

export class SingleLineTextFieldDto extends SingleLineTextFieldCore implements IFieldBase {
  convertCellValue2DBValue(value: unknown): unknown {
    return value;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    return value;
  }
}
