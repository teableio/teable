import { ApiProperty } from '@nestjs/swagger';
import { NumberField } from '@teable-group/core';
import type { NumberFieldOptions } from '@teable-group/core';
import type { DbFieldType } from '../../constant';

export class NumberOptionsDto implements NumberFieldOptions {
  @ApiProperty({
    type: Number,
    example: 2,
    description:
      'the display precision of the number, caveat: the precision is just a formatter, it dose not effect the storing value of the record',
  })
  precision!: number;
}

export class NumberFieldDto extends NumberField {
  dbFieldType!: DbFieldType.Real;
}
