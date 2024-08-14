import type { FieldType, IFilterItem } from '@teable/core';
import type {
  IFieldInstance,
  LinkField,
  UserField,
  CreatedByField,
  LastModifiedByField,
} from '../../../model';
import type { IBaseFilterValue, IConditionItemProperty } from '../types';
import type { ILinkContext } from './component/filter-link/context';

export interface IViewFilterConditionItem extends IConditionItemProperty {
  field: string | null;
  operator: IFilterItem['operator'];
  value: IFilterItem['value'];
}

export type IBaseViewFilter<T extends IConditionItemProperty = IViewFilterConditionItem> =
  IBaseFilterValue<T>;

export interface IFilterEditorProps<T = unknown, F = IFieldInstance> {
  field: F;
  operator: string;
  value: T;
  onSelect: (value: T) => void;
}

export interface IFilterComponents {
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

export type IViewFilterLinkContext = ILinkContext;
