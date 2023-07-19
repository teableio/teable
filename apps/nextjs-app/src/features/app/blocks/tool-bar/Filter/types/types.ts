import type { IFilter, IFilterMeta, IFilterSet } from '@teable-group/core';

interface IFilterProps {
  filters: IFilter;
  onChange?: (filters: IFilter | null) => void;
}

interface IConditionProps {
  index: number;
  filter: IFilterMeta;
  parent: IFilter;
  level: number;
}

interface IConditionGroupProps {
  index: number;
  filter: IFilterSet;
  parent: IFilter;
  level: number;
}

export type { IFilterProps, IConditionProps, IConditionGroupProps, IFilter };
