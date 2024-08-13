import type { IFilter, IFilterItem, IFilterSet, IConjunction, FieldType } from '@teable/core';
import type {
  IFieldInstance,
  LinkField,
  UserField,
  CreatedByField,
  LastModifiedByField,
} from '../../../model';

enum ConditionAddType {
  ITEM = 'item',
  GROUP = 'group',
}

type IFiltersPath = (string | number)[];

interface IFilterProps {
  filters: IFilter | null;
  contentHeader?: React.ReactNode;
  context?: IFilterContextMap;
  components?: IFilterComponents;
  onChange?: (filters: IFilter | null) => void;
  children?: (text: string, isActive?: boolean) => React.ReactNode;
}

interface IFilterBaseProps {
  filters: IFilter | null;
  fields: IFieldInstance[];
  components?: IFilterComponents;
  context?: IFilterContextMap;
  onChange?: (filters: IFilter | null) => void;
  children?: React.ReactNode;
  contentHeader?: React.ReactNode;
}

interface IConditionCommon {
  index: number;
  conjunction: IConjunction;
  level: number;
  path: IFiltersPath;
  customFieldValue?: (
    filter: IFilterItem,
    onSelect: (value: IFilterItem['value']) => void
  ) => JSX.Element;
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
  [FieldType.User]?: (
    props: IFilterEditorProps<
      string | string[] | null,
      UserField | CreatedByField | LastModifiedByField
    >
  ) => JSX.Element;
  [FieldType.CreatedBy]?: (
    props: IFilterEditorProps<
      string | string[] | null,
      UserField | CreatedByField | LastModifiedByField
    >
  ) => JSX.Element;
  [FieldType.LastModifiedBy]?: (
    props: IFilterEditorProps<
      string | string[] | null,
      UserField | CreatedByField | LastModifiedByField
    >
  ) => JSX.Element;
  [FieldType.Link]?: (
    props: IFilterEditorProps<string | string[] | null, LinkField>
  ) => JSX.Element;
}

interface IFilterContextMap {
  [FieldType.Link]: {
    isLoading?: boolean;
    data?: {
      tableId: string;
      data: Record<string, string | undefined>;
    }[];
  };
}

export type {
  IFilterProps,
  IFilterBaseProps,
  IConditionProps,
  IConditionGroupProps,
  IFilter,
  IFiltersPath,
  IFilterComponents,
  IFilterContextMap,
};
export { ConditionAddType };
