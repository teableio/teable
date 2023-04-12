import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { IUpdateRecordRo } from '@teable-group/core';
import { FieldKeyType } from '@teable-group/core';
import { RECORD_DEFINE } from './constant';

export class UpdateRecordRo implements IUpdateRecordRo {
  @ApiPropertyOptional({
    description: 'Define the field key type when create and return records',
    example: 'name',
    default: 'name',
    enum: FieldKeyType,
  })
  fieldKeyType?: FieldKeyType;

  @ApiProperty({
    description: `
object with a fields key mapping fieldId or field name to value for that field.
${RECORD_DEFINE}
`,
    example: {
      fields: {
        name: 'Bieber',
      },
    },
  })
  record!: {
    fields: { [fieldIdOrName: string]: unknown };
  };
}
