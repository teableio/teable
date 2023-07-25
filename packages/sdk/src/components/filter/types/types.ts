import type { IFilter, IFilterMeta, IFilterSet } from '@teable-group/core';

interface IFilterProps {
  filters: IFilter;
  onChange?: (filters: IFilter | null) => void;
}

interface IConditionCommon {
  index: number;
  parent: IFilter;
  level: number;
}

interface IConditionProps extends IConditionCommon {
  filter: IFilterMeta;
}

interface IConditionGroupProps extends IConditionCommon {
  filter: IFilterSet;
}

export type { IFilterProps, IConditionProps, IConditionGroupProps, IFilter };
