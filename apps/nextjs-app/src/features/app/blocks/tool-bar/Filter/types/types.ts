import type { IFilter, IFilterMeta, IFilterSet } from '@teable-group/core';

interface IFilterProps {
  filters: IFilter;
  onChange?: (filters: IFilter) => void;
}

interface IConditionProps {
  index: number;
  filter: IFilterMeta;
  parent: IFilter;
}

interface IConditionGroupProps {
  index: number;
  filter: IFilterSet;
  parent: IFilter;
  level: number;
}

export type { IFilterProps, IConditionProps, IConditionGroupProps, IFilter };
