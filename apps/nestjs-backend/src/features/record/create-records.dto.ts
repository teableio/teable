import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FieldKeyType } from './constant';

export class CreateRecordsDto {
  @ApiPropertyOptional({
    description: 'Define the field key type when create and return records',
    example: 'name',
    default: 'name',
    enum: FieldKeyType,
  })
  fieldKeyType?: FieldKeyType;

  @ApiProperty({
    description:
      'Array of objects with a fields key mapping fieldId or field name to value for that field.',
    example: [
      {
        fields: {
          name: 'Bieber',
        },
      },
    ],
  })
  records!: {
    fields: { [fieldIdOrName: string]: unknown };
  }[];
}
