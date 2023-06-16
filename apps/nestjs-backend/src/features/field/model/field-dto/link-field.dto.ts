import { ApiProperty } from '@nestjs/swagger';
import { CellValueType, DbFieldType, LinkFieldCore, Relationship } from '@teable-group/core';
import type { LinkFieldOptions, ILinkCellValue } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import type { CreateFieldRo } from '../create-field.ro';
import type { IFieldBase } from '../field-base';

export class LinkOptionsDto implements LinkFieldOptions {
  @ApiProperty({
    description: 'describe the relationship from this table to the foreign table',
    enum: Relationship,
  })
  relationship!: Relationship;

  @ApiProperty({
    description: 'the table this field is linked to',
  })
  foreignTableId!: string;

  @ApiProperty({
    description:
      'The value of the lookup Field in the associated table will be displayed as the current field.',
  })
  lookupFieldId!: string;

  @ApiProperty({
    description: 'The foreign key field name used to store values in the db table.',
  })
  dbForeignKeyName!: string;

  @ApiProperty({
    description: 'the symmetric field in the foreign table.',
  })
  symmetricFieldId!: string;
}

export class LinkFieldDto extends LinkFieldCore implements IFieldBase {
  static factory(fieldRo: CreateFieldRo) {
    const isMultipleCellValue =
      fieldRo.lookupOptions && fieldRo.lookupOptions.relationShip !== Relationship.ManyOne;

    const options = fieldRo.options as LinkFieldOptions;

    return plainToInstance(LinkFieldDto, {
      ...fieldRo,
      isComputed: true,
      cellValueType: CellValueType.String,
      isMultipleCellValue: options.relationship !== Relationship.ManyOne || isMultipleCellValue,
      dbFieldType: DbFieldType.Text,
    } as LinkFieldDto);
  }

  convertCellValue2DBValue(value: unknown): unknown {
    return value && JSON.stringify(value);
  }

  convertDBValue2CellValue(value: string): unknown {
    return value && JSON.parse(value);
  }

  updateCellTitle(
    value: ILinkCellValue | ILinkCellValue[],
    title: string | null | (string | null)[]
  ) {
    if (this.isMultipleCellValue) {
      const values = value as ILinkCellValue[];
      const titles = title as string[];
      return values.map((v, i) => ({
        id: v.id,
        title: titles[i],
      }));
    }
    return {
      id: (value as ILinkCellValue).id,
      title: title as string,
    };
  }
}
