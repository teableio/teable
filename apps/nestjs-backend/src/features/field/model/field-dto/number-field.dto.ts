import { ApiProperty } from '@nestjs/swagger';
import { NumberFieldCore } from '@teable-group/core';
import type { NumberFieldOptions } from '@teable-group/core';
import type { IFieldBase } from '../field-base';

export class NumberOptionsDto implements NumberFieldOptions {
  @ApiProperty({
    type: Number,
    example: 2,
    description:
      'the display precision of the number, caveat: the precision is just a formatter, it dose not effect the storing value of the record',
  })
  precision!: number;
}

export class NumberFieldDto extends NumberFieldCore implements IFieldBase {
  convertCellValue2DBValue(value: unknown): unknown {
    return value;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    return value;
  }
}
