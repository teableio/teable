import type { IFieldRo, IViewRo } from '@teable/core';
import { Colors, FieldType, ViewType } from '@teable/core';
import type { ICreateRecordsRo } from '@teable/openapi';

export const DEFAULT_FIELDS: IFieldRo[] = [
  { name: 'Name', type: FieldType.SingleLineText },
  {
    name: 'Count',
    type: FieldType.Number,
  },
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
    name: 'Grid view',
    type: ViewType.Grid,
    columnMeta: {},
  },
];

// eslint-disable-next-line @typescript-eslint/naming-convention
export const DEFAULT_RECORD_DATA: ICreateRecordsRo['records'] = [
  { fields: {} },
  { fields: {} },
  { fields: {} },
];
