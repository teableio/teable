import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import type { IFieldRo } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { NumberOptionsDto } from './field-dto/number-field.dto';
import { SingleSelectOptionsDto } from './field-dto/single-select-field.dto';

@ApiExtraModels(SingleSelectOptionsDto)
@ApiExtraModels(NumberOptionsDto)
export class CreateFieldRo implements IFieldRo {
  @ApiProperty({
    description: 'The name of the field.',
    example: 'Single Select',
  })
  name!: string;

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
  type!: FieldType;

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

  @ApiPropertyOptional({
    description: `
The defaultValue of the field. The datatype of the value depends on the field type.
singleLineText, longText, singleSelect, date, phoneNumber, email, url: string, example: "hello".
number, currency, percent, duration, rating: number, example: 1.
checkbox: boolean, example: true.
multipleSelect: string[], example: ["red", "blue"].
other fields do not support defaultValue.
`,
    example: { name: 'light', color: 'yellow' },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultValue?: any;

  @ApiPropertyOptional({
    description: 'Set if it is a primary field',
  })
  isPrimary?: boolean;

  @ApiPropertyOptional({
    description: 'Set if value are not allowed to be null, not all fields support this option.',
    example: false,
  })
  notNull?: boolean;

  @ApiPropertyOptional({
    description:
      'Set if value are not allowed to be duplicated, not all fields support this option.',
    example: false,
  })
  unique?: boolean;
}
