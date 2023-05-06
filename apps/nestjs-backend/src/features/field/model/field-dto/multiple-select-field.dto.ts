import { ApiProperty } from '@nestjs/swagger';
import { MultipleSelectFieldCore, Colors } from '@teable-group/core';
import type { MultipleSelectFieldChoices, MultipleSelectFieldOptions } from '@teable-group/core';

class MultipleSelectOption implements MultipleSelectFieldChoices {
  @ApiProperty({
    type: String,
    example: 'light',
    description: 'Name of the option.',
  })
  name!: string;

  @ApiProperty({
    enum: Colors,
    example: Colors.Yellow,
    description: 'The color of the option.',
  })
  color!: Colors;
}

export class MultipleSelectOptionsDto implements MultipleSelectFieldOptions {
  @ApiProperty({
    type: [MultipleSelectOption],
    description:
      'The display precision of the number, caveat: the precision is just a formatter, it dose not effect the storing value of the record',
  })
  choices!: MultipleSelectOption[];
}

export class MultipleSelectFieldDto extends MultipleSelectFieldCore {}
