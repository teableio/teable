import { Colors, FieldType, ViewType } from '@teable-group/core';

export const DEFAULT_FIELDS = [
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
export const DEFAULT_VIEW = {
  name: 'GridView',
  type: ViewType.Grid,
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const DEFAULT_RECORDS = {
  records: [{ fields: {} }, { fields: {} }, { fields: {} }],
};
