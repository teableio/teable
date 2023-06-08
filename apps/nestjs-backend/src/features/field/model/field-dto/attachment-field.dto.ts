import { AttachmentFieldCore } from '@teable-group/core';
import type { IFieldBase } from '../field-base';

export class AttachmentFieldDto extends AttachmentFieldCore implements IFieldBase {
  convertCellValue2DBValue(value: unknown): unknown {
    return value == null ? value : JSON.stringify(value);
  }

  convertDBValue2CellValue(value: string): unknown {
    return value == null ? value : JSON.parse(value);
  }
}
