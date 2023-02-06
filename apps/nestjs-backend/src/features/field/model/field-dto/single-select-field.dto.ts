import { ApiProperty } from '@nestjs/swagger';
import { SingleSelectField, Colors } from '@teable-group/core';
import type { SingleSelectFieldChoices, SingleSelectFieldOptions } from '@teable-group/core';
import type { DbFieldType } from '../../constant';

class SingleSelectOption implements SingleSelectFieldChoices {
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

export class SingleSelectOptionsDto implements SingleSelectFieldOptions {
  @ApiProperty({
    type: [SingleSelectOption],
    description:
      'The display precision of the number, caveat: the precision is just a formatter, it dose not effect the storing value of the record',
  })
  choices!: SingleSelectOption[];
}

export class SingleSelectFieldDto extends SingleSelectField {
  dbFieldType!: DbFieldType.Text;
}
