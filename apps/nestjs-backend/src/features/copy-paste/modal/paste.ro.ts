import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNumber, Length } from 'class-validator';
import type { FieldVo } from 'src/features/field/model/field.vo';

export class PasteRo {
  @ApiProperty({
    type: String,
    description: 'Content to paste',
    example: 'John\tDoe\tjohn.doe@example.com',
  })
  content!: string;

  @ApiProperty({
    type: String,
    description: 'Starting cell for paste operation',
    example: [1, 2],
  })
  @IsArray()
  @Length(2, 2)
  @IsNumber({}, { each: true })
  cell!: [number, number];

  @ApiProperty({
    type: Array<FieldVo>,
    description: 'Table header for paste operation',
    example: [],
  })
  @Length(1)
  @IsArray()
  header!: FieldVo[];
}
