import { FieldType, ViewType } from '@teable-group/core';
import type { CreateFieldDto } from '../field/create-field.dto';
import type { CreateViewDto } from '../view/create-view.dto';

export const DEFAULT_FIELDS: CreateFieldDto[] = [
  { name: 'name', type: FieldType.SingleLineText },
  { name: 'number', type: FieldType.Number },
  { name: 'status', type: FieldType.SingleSelect },
];

// eslint-disable-next-line @typescript-eslint/naming-convention
export const DEFAULT_VIEW: CreateViewDto = {
  name: 'GridView',
  type: ViewType.Grid,
};
