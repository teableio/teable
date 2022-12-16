import { ApiProperty } from '@nestjs/swagger';
import { Colors } from '@teable-group/core';
import type { ISingleSelectFieldChoices, ISingleSelectFieldOptions } from '@teable-group/core';

class SingleSelectOption implements ISingleSelectFieldChoices {
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

export class SingleSelectOptionsDto implements ISingleSelectFieldOptions {
  @ApiProperty({
    type: [SingleSelectOption],
    description:
      'The display precision of the number, caveat: the precision is just a formatter, it dose not effect the storing value of the record',
  })
  choices!: SingleSelectOption[];
}
