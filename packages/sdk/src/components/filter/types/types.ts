import type { IFilter, IFilterItem, IFilterSet } from '@teable-group/core';

enum ConditionAddType {
  ITEM = 'item',
  GROUP = 'group',
}

interface IFilterProps {
  filters: IFilter;
  onChange?: (filters: IFilter | null) => void;
  children?: (text: string, isActive?: boolean) => React.ReactNode;
}

interface IConditionCommon {
  index: number;
  conjunction: IFilter['conjunction'];
  level: number;
  path: string[];
}

interface IConditionProps extends IConditionCommon {
  filter: IFilterItem;
}

interface IConditionGroupProps extends IConditionCommon {
  filter: IFilterSet;
}

export type { IFilterProps, IConditionProps, IConditionGroupProps, IFilter };
export { ConditionAddType };
