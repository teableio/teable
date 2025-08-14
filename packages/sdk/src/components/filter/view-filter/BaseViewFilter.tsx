import { getValidFilterOperators } from '@teable/core';
import type { IFilter } from '@teable/core';
import { useMemo } from 'react';
import type { IFieldInstance } from '../../../model';
import { BaseFilter } from '../BaseFilter';
import type { IFilterBaseComponent, IConditionItemProperty } from '../types';
import { ViewFilterContext } from './context';
import { FieldSelect, OperatorSelect, FieldValue } from './custom-component';
import type { IBaseViewFilter, IViewFilterConditionItem, IViewFilterLinkContext } from './types';
import { viewFilter2BaseFilter, baseFilter2ViewFilter } from './utils';

interface IViewFilterProps<T extends IConditionItemProperty = IViewFilterConditionItem> {
  value: IFilter;
  fields: IFieldInstance[];
  onChange: (value: IFilter) => void;
  /**
   * why there is required instead of optional?
   * 1. in this view filter, link is required
   * 2. this context is for selected link item title display
   * 3. it's better to not set default context, because of when this component is used in other unknown place may cause unexpected behavior
   */
  viewFilterLinkContext: IViewFilterLinkContext;
  customValueComponent?: IFilterBaseComponent<T> & { modal?: boolean };
  operatorSelect?: IFilterBaseComponent<T>;
}

export const BaseViewFilter = <T extends IConditionItemProperty = IViewFilterConditionItem>(
  props: IViewFilterProps<T> & { modal?: boolean }
) => {
  const { value: filter, onChange, customValueComponent, fields, operatorSelect } = props;

  const baseFilter = useMemo<IBaseViewFilter<T>>(() => {
    return viewFilter2BaseFilter(filter);
  }, [filter]);

  const onChangeHandler = (value: IBaseViewFilter<T>) => {
    onChange(baseFilter2ViewFilter(value));
  };

  const defaultField = useMemo(() => fields?.[0] || {}, [fields]);

  const defaultItemValue = useMemo<T>(() => {
    return {
      field: defaultField.id || null,
      operator: getValidFilterOperators(defaultField)[0] || null,
      value: null,
    } as T;
  }, [defaultField]);

  return (
    <ViewFilterContext.Provider
      value={{ fields, viewFilterLinkContext: props.viewFilterLinkContext }}
    >
      <BaseFilter<T>
        defaultItemValue={defaultItemValue}
        value={baseFilter}
        onChange={onChangeHandler}
        footerClassName="p-2 pt-0"
        contentClassName="py-2 px-3"
        components={{
          FieldComponent: FieldSelect,
          OperatorComponent: operatorSelect ?? OperatorSelect,
          ValueComponent: customValueComponent ?? FieldValue,
        }}
      />
    </ViewFilterContext.Provider>
  );
};
