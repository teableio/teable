import { Colors, FieldType, ViewType } from '@teable-group/core';
import type { CreateFieldRo } from '../field/model/create-field.ro';
import type { CreateRecordsDto } from '../record/create-records.dto';
import type { CreateViewDto } from '../view/create-view.dto';

export const DEFAULT_FIELDS: CreateFieldRo[] = [
  { name: 'name', type: FieldType.SingleLineText },
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
export const DEFAULT_VIEW: CreateViewDto = {
  name: 'GridView',
  type: ViewType.Grid,
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const DEFAULT_RECORDS: CreateRecordsDto = {
  records: [{ fields: {} }, { fields: {} }, { fields: {} }],
};
