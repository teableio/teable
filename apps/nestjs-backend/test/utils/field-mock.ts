import type { IFieldRo, INumberFieldOptions, ISelectFieldOptions } from '@teable-group/core';
import { Colors, FieldType, NumberFormattingType } from '@teable-group/core';

export const FIELD_MOCK_DATA: IFieldRo[] = [
  {
    name: 'description',
    type: FieldType.SingleLineText,
    description: 'first field',
  },
  {
    name: 'wight',
    type: FieldType.SingleSelect,
    options: {
      choices: [
        {
          name: 'light',
          color: Colors.Gray,
        },
        {
          name: 'medium',
          color: Colors.Yellow,
        },
        {
          name: 'heavy',
          color: Colors.Red,
        },
      ],
    } as ISelectFieldOptions,
  },
  {
    name: 'count',
    type: FieldType.Number,
    options: {
      formatting: { type: NumberFormattingType.Decimal, precision: 2 },
    } as INumberFieldOptions,
  },
];
