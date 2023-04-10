import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ICreateRecordsDto } from '@teable-group/core';
import { FieldKeyType } from '@teable-group/core';

export class CreateRecordsDto implements ICreateRecordsDto {
  @ApiPropertyOptional({
    description: 'Define the field key type when create and return records',
    example: 'name',
    default: 'name',
    enum: FieldKeyType,
  })
  fieldKeyType?: FieldKeyType;

  @ApiProperty({
    description: `
Array of objects with a fields key mapping fieldId or field name to value for that field.
singleLineText, type: string, example: "bieber"
longText, type: string, example: "line1\nline2"
singleLineText, type: string, example: "bieber"
attachment, type: string, example: "bieber"
checkbox, type: string, example: "true"
multipleSelect, type: string[], example: ["red", "green"]
singleSelect, type: string, example: "In Progress"
date, type: string, example: "2012/12/12"
phoneNumber, type: string, example: "1234567890"
email, type: string, example: "address@teable.io"
url, type: string, example: "https://teable.io"
number, type: number, example: 1
currency, type: number, example: 1
percent, type: number, example: 1
duration, type: number, example: 1
rating, type: number, example: 1
formula,type: string, example: "bieber"
rollup, type: string, example: "bieber"
count, type: number, example: 1
multipleRecordLinks, type: string, example: "bieber"
multipleLookupValues, type: string, example: "bieber"
createdTime, type: string, example: "2012/12/12 03:03"
lastModifiedTime, type: string, example: "2012/12/12 03:03"
createdBy, type: string, example: "bieber"
lastModifiedBy, type: string, example: "bieber"
autoNumber, type: number, example: 1
button, type: string, example: "click"
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
