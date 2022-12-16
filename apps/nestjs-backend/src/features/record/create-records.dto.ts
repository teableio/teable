import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FieldKeyType } from './constant';

export class CreateRecordsDto {
  @ApiPropertyOptional({
    description: 'Define the field key type when create and return records, default is `name`',
    example: 'name',
    default: 'name',
  })
  fieldKeyType?: FieldKeyType;

  @ApiProperty({
    description:
      'Array of objects with a fields key mapping fieldId or field name to value for that field.',
    example: [
      {
        fields: {
          fldXXXXXXXXXXXXXXX: 'text value',
        },
      },
    ],
  })
  records!: {
    fields: { [fieldIdOrName: string]: unknown };
  }[];
}
