import type { IFilterItem } from '@teable/core';
import { useCrud } from '../../hooks';
import type { IFilterComponents } from '../../index';
import type { IBaseFilterCustomComponentProps, IConditionItemProperty } from '../../types';
import { useViewFilterContext } from '../hooks';
import { useFields } from '../hooks/useFields';
import type { IViewFilterConditionItem } from '../types';
import { BaseFieldValue } from './BaseFieldValue';

interface IFieldValue<T extends IConditionItemProperty = IViewFilterConditionItem>
  extends IBaseFilterCustomComponentProps<T, T['value']> {
  components?: IFilterComponents;
}

export const FieldValue = <T extends IConditionItemProperty = IViewFilterConditionItem>(
  props: IFieldValue<T>
) => {
  const { path, components, value, item, modal } = props;
  const fields = useFields();
  const { onChange } = useCrud();
  const linkContext = useViewFilterContext();
  const field = fields.find((f) => f.id === item.field);

  return (
    <BaseFieldValue
      value={value}
      field={field}
      modal={modal}
      components={components}
      operator={item.operator as IFilterItem['operator']}
      onSelect={(newValue) => {
        if (newValue === '' || (Array.isArray(newValue) && !newValue.length)) {
          onChange(path, null);
          return;
        }
        onChange(path, newValue);
      }}
      linkContext={linkContext}
    />
  );
};
