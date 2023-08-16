import { ApiProperty } from '@nestjs/swagger';
import { Colors, SingleNumberDisplayType, MultiNumberDisplayType } from '@teable-group/core';
import type { IMultiNumberShowAs, ISingleNumberShowAs } from '@teable-group/core';

export class SingleNumberShowAsDto implements ISingleNumberShowAs {
  @ApiProperty({
    enum: SingleNumberDisplayType,
    example: SingleNumberDisplayType.Bar,
    description: 'the display type of the number.',
  })
  type!: SingleNumberDisplayType;

  @ApiProperty({
    enum: Colors,
    example: Colors.TealBright,
    description: 'The color of the rendering graph.',
  })
  color!: Colors;

  @ApiProperty({
    type: Boolean,
    example: false,
    description: 'Whether to display the value.',
  })
  showValue!: boolean;

  @ApiProperty({
    type: Number,
    example: 100,
    description: 'The max value of the rendering graph.',
  })
  maxValue!: number;
}

export class MultiNumberShowAsDto implements IMultiNumberShowAs {
  @ApiProperty({
    enum: MultiNumberDisplayType,
    example: MultiNumberDisplayType.Line,
    description: 'the display type of the numbers.',
  })
  type!: MultiNumberDisplayType;

  @ApiProperty({
    enum: Colors,
    example: Colors.TealBright,
    description: 'The color of the rendering graph.',
  })
  color!: Colors;
}
