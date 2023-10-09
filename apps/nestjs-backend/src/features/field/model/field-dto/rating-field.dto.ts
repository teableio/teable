import { ApiProperty } from '@nestjs/swagger';
import { RatingFieldCore, RatingIcon, IRatingColors, Colors } from '@teable-group/core';
import type { IRatingFieldOptions } from '@teable-group/core';
import type { IFieldBase } from '../field-base';

export class RatingOptionsDto implements IRatingFieldOptions {
  @ApiProperty({
    type: RatingIcon,
    example: RatingIcon.Star,
    description: 'the icon for the rating field',
  })
  icon!: RatingIcon;

  @ApiProperty({
    type: 'string',
    example: Colors.YellowBright,
    description: 'the color of icon display for the rating field',
  })
  color!: IRatingColors;

  @ApiProperty({
    type: 'number',
    example: 5,
    description: 'the maximum values for the rating field',
  })
  max!: number;
}

export class RatingFieldDto extends RatingFieldCore implements IFieldBase {
  convertCellValue2DBValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return JSON.stringify(value);
    }
    return value;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value && JSON.parse(value as string);
    }
    return value;
  }
}
