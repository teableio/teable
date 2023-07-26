import type { ICreateRecordsRo, IFieldRo, IViewRo } from '@teable-group/core';
import { Colors, FieldType, ViewType } from '@teable-group/core';

export const DEFAULT_FIELDS: IFieldRo[] = [
  { name: 'Name', type: FieldType.SingleLineText, isPrimary: true, options: {} },
  { name: 'Count', type: FieldType.Number, options: { formatting: { precision: 0 } } },
  {
    name: 'Status',
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
export const DEFAULT_VIEWS: IViewRo[] = [
  {
    name: 'GridView',
    type: ViewType.Grid,
  },
];

// eslint-disable-next-line @typescript-eslint/naming-convention
export const DEFAULT_RECORD_DATA: ICreateRecordsRo['records'] = [
  { fields: {} },
  { fields: {} },
  { fields: {} },
];
