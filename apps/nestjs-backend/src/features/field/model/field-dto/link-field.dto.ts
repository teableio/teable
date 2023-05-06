import { ApiProperty } from '@nestjs/swagger';
import { LinkFieldCore, Relationship } from '@teable-group/core';
import type { LinkFieldOptions } from '@teable-group/core';

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

export class LinkFieldDto extends LinkFieldCore {}
