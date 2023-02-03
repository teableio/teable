import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import type { IFieldBase } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { NumberOptionsDto } from './options-dto/number.dto';
import { SingleSelectOptionsDto } from './options-dto/single-select.dto';

export type IFieldCreateDto = Omit<IFieldBase, 'id'>;

@ApiExtraModels(SingleSelectOptionsDto)
@ApiExtraModels(NumberOptionsDto)
export abstract class CreateFieldDto implements IFieldCreateDto {
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
  options?: SingleSelectOptionsDto | NumberOptionsDto;

  @ApiPropertyOptional({
    description:
      'The defaultValue of the field. The datatype of the value depends on the field type.',
    example: { name: 'light', color: 'yellow' },
  })
  defaultValue?: string;

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
