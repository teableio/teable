import { ApiProperty } from '@nestjs/swagger';
import type { ISingleSelectFieldOptions } from '@teable-group/core';
import { Colors } from '@teable-group/core';

export class SingleSelectOptionsDto implements ISingleSelectFieldOptions {
  @ApiProperty({
    type: Array,
    example: [
      {
        name: 'dinner',
        color: Colors.Blue,
      },
      {
        name: 'lunch',
        color: Colors.Yellow,
      },
    ],
    description:
      'the display precision of the number, caveat: the precision is just a formatter, it dose not effect the storing value of the record',
  })
  choices!: ISingleSelectFieldOptions['choices'];
}
