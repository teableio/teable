import { Optional } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Validate } from 'class-validator';

const rangeValidator = (value: string) => {
  const arrayValue = JSON.parse(value);
  if (!Array.isArray(arrayValue) || arrayValue.length % 2 !== 0) {
    return false;
  }
  for (const arr of arrayValue) {
    if (!Array.isArray(arr) || arr.length !== 2) {
      return false;
    }
  }
  return true;
};

export enum RangeType {
  Column = 'column',
  Row = 'row',
}

export class CopyRo {
  @ApiProperty({
    type: String,
    description:
      'The parameter "ranges" is used to represent the coordinates of a selected range in a table. ',
    example: '[[0, 0],[1, 1]]',
  })
  @IsString()
  @Validate(rangeValidator, {
    message: 'The range parameter must be a valid 2D array with even length.',
  })
  ranges!: string;

  @ApiProperty({
    type: String,
    description: 'Types of non-contiguous selections',
    example: 'column',
  })
  @Optional()
  @Validate(IsEnum(RangeType))
  type!: RangeType;
}
