import type { IFilterItem } from '@teable/core';
import { useMemo } from 'react';
import { useCrud } from '../../hooks';
import type { IFilterComponents } from '../../index';
import type { IBaseFilterCustomComponentProps, IConditionItemProperty } from '../../types';
import { useViewFilterContext } from '../hooks';
import { useFields } from '../hooks/useFields';
import type { IViewFilterConditionItem } from '../types';
import { BaseFieldValue } from './BaseFieldValue';
import type { IFilterReferenceSource } from './BaseFieldValue';

interface IFieldValue<T extends IConditionItemProperty = IViewFilterConditionItem>
  extends IBaseFilterCustomComponentProps<T, T['value']> {
  components?: IFilterComponents;
  referenceSource?: IFilterReferenceSource;
}

export const FieldValue = <T extends IConditionItemProperty = IViewFilterConditionItem>(
  props: IFieldValue<T>
) => {
  const { path, components, value, item, modal, referenceSource } = props;
  const fields = useFields();
  const { onChange } = useCrud();
  const linkContext = useViewFilterContext();
  const field = fields.find((f) => f.id === item.field);

  const defaultReferenceSource = useMemo<IFilterReferenceSource | undefined>(() => {
    if (!field) {
      return referenceSource;
    }
    if (referenceSource?.fields?.length) {
      return referenceSource;
    }
    const candidates = field.tableId
      ? fields.filter((candidate) => candidate.tableId === field.tableId)
      : fields;
    if (!candidates.length) {
      return referenceSource;
    }
    return {
      fields: candidates,
      tableId: field.tableId ?? candidates[0]?.tableId,
    };
  }, [field, fields, referenceSource]);

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
      referenceSource={defaultReferenceSource}
    />
  );
};
