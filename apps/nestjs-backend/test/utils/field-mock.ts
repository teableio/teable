import type { INumberFieldOptions, ISelectFieldOptions } from '@teable-group/core';
import { Colors, FieldType } from '@teable-group/core';
import type { CreateFieldRo } from '../../src/features/field/model/create-field.ro';

export const FIELD_MOCK_DATA: CreateFieldRo[] = [
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
      formatting: { precision: 2 },
    } as INumberFieldOptions,
  },
];
