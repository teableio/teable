import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ICreateRecordsRo } from '@teable-group/core';
import { FieldKeyType } from '@teable-group/core';
import { RECORD_DEFINE } from './constant';

export class CreateRecordsRo implements ICreateRecordsRo {
  @ApiPropertyOptional({
    description: 'Define the field key type when create and return records',
    example: 'name',
    default: 'name',
    enum: FieldKeyType,
  })
  fieldKeyType?: FieldKeyType = FieldKeyType.Name;

  @ApiProperty({
    description: `
Array of objects with a fields key mapping fieldId or field name to value for that field.
${RECORD_DEFINE}
`,
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
