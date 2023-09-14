import { MultipleSelectFieldCore } from '@teable-group/core';
import type { IFieldBase } from '../field-base';
import { SingleSelectOptionsDto } from './single-select-field.dto';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const MultipleSelectOptionsDto = SingleSelectOptionsDto;

export class MultipleSelectFieldDto extends MultipleSelectFieldCore implements IFieldBase {
  convertCellValue2DBValue(value: unknown): string | null {
    return value == null ? null : JSON.stringify(value);
  }

  convertDBValue2CellValue(value: string): string[] {
    return value == null ? value : JSON.parse(value);
  }
}
