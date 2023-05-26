import { Colors, FieldType, ViewType } from '@teable-group/core';
import type { CreateFieldRo } from '../field/model/create-field.ro';
import type { CreateRecordsRo } from '../record/create-records.ro';
import type { CreateViewRo } from '../view/model/create-view.ro';

export const DEFAULT_FIELDS: CreateFieldRo[] = [
  { name: 'name', type: FieldType.SingleLineText, isPrimary: true },
  { name: 'number', type: FieldType.Number, options: { precision: 2 } },
  {
    name: 'status',
    type: FieldType.SingleSelect,
    options: {
      choices: [
        {
          name: 'light',
          color: Colors.GrayBright,
        },
        {
          name: 'medium',
          color: Colors.YellowBright,
        },
        {
          name: 'heavy',
          color: Colors.TealBright,
        },
      ],
    },
  },
];

// eslint-disable-next-line @typescript-eslint/naming-convention
export const DEFAULT_VIEW: CreateViewRo = {
  name: 'GridView',
  type: ViewType.Grid,
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const DEFAULT_RECORDS: CreateRecordsRo = {
  records: [{ fields: {} }, { fields: {} }, { fields: {} }],
};
