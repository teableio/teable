import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { FieldType, LookupOptions } from '@teable-group/core';
import type { IFieldRo } from '@teable-group/core';
import { IsOptional, ValidateIf } from 'class-validator';
import { DateOptionsDto } from './field-dto/date-field.dto';
import { FormulaOptionsDto } from './field-dto/formula-field.dto';
import { LinkOptionsDto } from './field-dto/link-field.dto';
import { MultipleSelectOptionsDto } from './field-dto/multiple-select-field.dto';
import { NumberOptionsDto } from './field-dto/number-field.dto';
import { SingleSelectOptionsDto } from './field-dto/single-select-field.dto';

@ApiExtraModels(LinkOptionsDto)
@ApiExtraModels(FormulaOptionsDto)
@ApiExtraModels(MultipleSelectOptionsDto)
@ApiExtraModels(SingleSelectOptionsDto)
@ApiExtraModels(NumberOptionsDto)
@ApiExtraModels(DateOptionsDto)
export class CreateFieldRo implements IFieldRo {
  @ApiPropertyOptional({
    description:
      'The id of the field that start with "fld", followed by exactly 16 alphanumeric characters `/^fld[\\da-zA-Z]{16}$/`. specify id when create sometimes useful',
    example: 'Single Select',
  })
  @IsOptional()
  @ValidateIf((o) => /^fld[\da-zA-Z]{16}$/.test(o.id), {
    message:
      'id is illegal, it must start with "fld", followed by exactly 16 alphanumeric characters `/^fld[\\da-zA-Z]{16}$/`',
  })
  id?: string;

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
      { $ref: getSchemaPath(FormulaOptionsDto) },
      { $ref: getSchemaPath(LinkOptionsDto) },
      { $ref: getSchemaPath(MultipleSelectOptionsDto) },
      { $ref: getSchemaPath(SingleSelectOptionsDto) },
      { $ref: getSchemaPath(NumberOptionsDto) },
      { $ref: getSchemaPath(DateOptionsDto) },
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
    description: 'Set the field is lookup field',
  })
  isLookup?: boolean;

  @ApiPropertyOptional({
    description: 'Set the field is lookup field',
    type: LookupOptions,
  })
  lookupOptions?: LookupOptions | undefined;

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
