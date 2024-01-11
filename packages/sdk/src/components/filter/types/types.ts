import type { IFilter, IFilterItem, IFilterSet, IConjunction } from '@teable-group/core';
import type { IFieldInstance } from '../../../model';

enum ConditionAddType {
  ITEM = 'item',
  GROUP = 'group',
}

type IFiltersPath = (string | number)[];

interface IFilterProps {
  filters: IFilter | null;
  contentHeader?: React.ReactNode;
  onChange?: (filters: IFilter | null) => void;
  children?: (text: string, isActive?: boolean) => React.ReactNode;
}

interface IFilterBaseProps {
  filters: IFilter | null;
  fields: IFieldInstance[];
  onChange?: (filters: IFilter | null) => void;
  children?: React.ReactNode;
  contentHeader?: React.ReactNode;
}

interface IConditionCommon {
  index: number;
  conjunction: IConjunction;
  level: number;
  path: IFiltersPath;
}

interface IConditionProps extends IConditionCommon {
  filter: IFilterItem;
}

interface IConditionGroupProps extends IConditionCommon {
  filter: IFilterSet;
}

export type {
  IFilterProps,
  IFilterBaseProps,
  IConditionProps,
  IConditionGroupProps,
  IFilter,
  IFiltersPath,
};
export { ConditionAddType };
