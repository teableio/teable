import { ApiProperty } from '@nestjs/swagger';
import type { SelectFieldChoices, SelectFieldOptions } from '@teable-group/core';
import { SingleSelectFieldCore, Colors } from '@teable-group/core';
import type { IFieldBase } from '../field-base';

class SingleSelectOption implements SelectFieldChoices {
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

export class SingleSelectOptionsDto implements SelectFieldOptions {
  @ApiProperty({
    type: [SingleSelectOption],
    description:
      'The display precision of the number, caveat: the precision is just a formatter, it dose not effect the storing value of the record',
  })
  choices!: SingleSelectOption[];
}

export class SingleSelectFieldDto extends SingleSelectFieldCore implements IFieldBase {
  convertCellValue2DBValue(value: unknown): unknown {
    return value;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    return value;
  }
}
