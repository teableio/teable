import { ApiProperty } from '@nestjs/swagger';
import type { INumberFieldOptions } from '@teable-group/core';

export class NumberOptionsDto implements INumberFieldOptions {
  @ApiProperty({
    type: Number,
    example: 2,
    description:
      'the display precision of the number, caveat: the precision is just a formatter, it dose not effect the storing value of the record',
  })
  precision!: number;
}
