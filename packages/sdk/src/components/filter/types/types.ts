import type { IFilter, IFilterItem, IFilterSet, IConjunction, FieldType } from '@teable/core';
import type { IFieldInstance, UserField } from '../../../model';

enum ConditionAddType {
  ITEM = 'item',
  GROUP = 'group',
}

type IFiltersPath = (string | number)[];

interface IFilterProps {
  filters: IFilter | null;
  contentHeader?: React.ReactNode;
  components?: IFilterComponents;
  onChange?: (filters: IFilter | null) => void;
  children?: (text: string, isActive?: boolean) => React.ReactNode;
}

interface IFilterBaseProps {
  filters: IFilter | null;
  fields: IFieldInstance[];
  components?: IFilterComponents;
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

interface IFilterEditorProps<T = unknown, F = IFieldInstance> {
  field: F;
  operator: string;
  value: T;
  onSelect: (value: T) => void;
}

interface IFilterComponents {
  [FieldType.User]: (props: IFilterEditorProps<string | string[] | null, UserField>) => JSX.Element;
}

export type {
  IFilterProps,
  IFilterBaseProps,
  IConditionProps,
  IConditionGroupProps,
  IFilter,
  IFiltersPath,
  IFilterComponents,
};
export { ConditionAddType };
