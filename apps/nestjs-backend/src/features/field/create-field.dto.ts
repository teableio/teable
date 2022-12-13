import { ApiProperty } from '@nestjs/swagger';
import type { IFieldBase } from '@teable-group/core';
import { FieldType } from '@teable-group/core';

type IFieldDto = Omit<IFieldBase, 'id' | 'calculatedType' | 'dataType' | 'isPrimaryField'>;

export class CreateFieldDto implements IFieldDto {
  @ApiProperty({
    description: 'The name of the field.',
    example: 'field1',
  })
  name!: string;

  @ApiProperty({
    description: 'The description of the field.',
    example: 'this is a summary',
  })
  description?: string | undefined;

  @ApiProperty({
    description: 'The types supported by teable.',
    example: FieldType.SingleLineText,
  })
  type!: FieldType;

  @ApiProperty({
    example: {
      id: 'sltxxxxxxxx',
      name: 'A',
      color: 'red',
    },
    description:
      "The configuration options of the field. The structure of the field's options depend on the field's type.",
  })
  options?: unknown;

  @ApiProperty({
    description:
      'The defaultValue of the field. The datatype of the value depends on the field type.',
    example: 'row title',
  })
  defaultValue?: string;

  @ApiProperty({
    description: 'Set if value are not allowed to be null, not all fields support this option.',
    example: 'row title',
  })
  notNull?: boolean | undefined;

  @ApiProperty({
    description:
      'Set if value are not allowed to be duplicated, not all fields support this option.',
    example: 'row title',
  })
  unique?: boolean | undefined;
}
