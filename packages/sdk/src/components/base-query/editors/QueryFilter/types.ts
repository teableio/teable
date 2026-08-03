import type { IBaseQueryFilterItem } from '@teable/openapi';

export type IBaseFilterItem = {
  field: IBaseQueryFilterItem['column'];
  operator: IBaseQueryFilterItem['operator'];
  value: IBaseQueryFilterItem['value'];
  type: IBaseQueryFilterItem['type'];
};
