/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { FieldType, NumberFormattingType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';

const textField = {
  name: 'text field',
  description: 'the text field',
  type: FieldType.SingleLineText,
};

const numberField = {
  name: 'Number field',
  description: 'the number field',
  type: FieldType.Number,
  options: {
    formatting: { type: NumberFormattingType.Decimal, precision: 1 },
  },
};

const linkField = (foreignTableId: string) => {
  return {
    name: 'link field（from 20x）',
    description: 'the link field',
    type: FieldType.Link,
    options: {
      relationship: Relationship.ManyMany,
      foreignTableId: foreignTableId,
      isOneWay: false,
    },
  };
};

export const DEFAULT_LINK_VALUE_INDEXS = [
  [0],
  [1],
  [3],
  [],
  [0, 1],
  [1, 2],
  [2, 3],
  [],
  [0, 1, 2],
  [1, 2, 3],
  [2, 3, 4],
  [],
  [4, 5, 6],
  [6, 7, 8],
  [8, 9, 10],
  [],
  [10, 11, 12, 13],
  [14, 15, 16, 17, 18],
  [17, 18, 19, 20, 21, 22],
];

export const x_20_link = (foreignTable: ITableFullVo) => {
  const foreignRecords = foreignTable.records;

  const link_field = linkField(foreignTable.id);

  const records: any[] = [];
  for (let i = 0; i < 20; i++) {
    const fields: { [key: string]: any } = {
      [textField.name]: `B-${i}`,
      [numberField.name]: i,
    };

    DEFAULT_LINK_VALUE_INDEXS[i]?.forEach((index) => {
      if (foreignRecords[index]) {
        (fields[link_field.name] = fields[link_field.name] ?? []).push({
          id: foreignRecords[index].id,
        });
      }
    });

    records.push({ fields });
  }

  return {
    fields: [textField, numberField, link_field],

    records: [
      {
        fields: {},
      },
      ...records,
    ],
  };
};

export const x_20_link_from_lookups = (foreignTable: ITableFullVo, linkFieldId: string) => {
  const fields: any[] = [];

  foreignTable.fields.forEach((field) => {
    const lookupField = {
      name: `lookup ${field.name} (from x_20)`,
      type: field.type,
      isLookup: true,
      isMultipleCellValue: field.isMultipleCellValue,
      lookupOptions: {
        foreignTableId: foreignTable.id,
        lookupFieldId: field.id,
        linkFieldId: linkFieldId,
      },
    };

    fields.push(lookupField);
  });

  return { fields };
};
