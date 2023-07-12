import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { FieldType, IColumnMeta } from '@teable-group/core';
import { NumberOptionsDto } from './field-dto/number-field.dto';
import { SingleSelectOptionsDto } from './field-dto/single-select-field.dto';

@ApiExtraModels(SingleSelectOptionsDto)
@ApiExtraModels(NumberOptionsDto)
export class UpdateFieldRo {
  @ApiProperty({
    description: 'The name of the field.',
    example: 'Single Select',
  })
  name?: string;

  @ApiProperty({
    description: 'The description of the field.',
    example: 'this is a summary',
  })
  description?: string;

  @ApiProperty({
    description: 'The types supported by teable.',
    example: FieldType.SingleSelect,
    enum: FieldType,
  })
  type?: FieldType;

  @ApiPropertyOptional({
    description:
      "The configuration options of the field. The structure of the field's options depend on the field's type.",
    oneOf: [
      { $ref: getSchemaPath(SingleSelectOptionsDto) },
      { $ref: getSchemaPath(NumberOptionsDto) },
    ],
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options?: any;

  @ApiProperty({
    description:
      'A mapping of view IDs to their corresponding column metadata, including order, width, and hidden status',
    properties: {
      viewId: {
        type: 'object',
        properties: {
          order: { type: 'number' },
          width: { type: 'number' },
          hidden: { type: 'boolean' },
        },
      },
    },
  })
  columnMeta?: IColumnMeta;
}
