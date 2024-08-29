import type { IBaseQueryFilter, IBaseQueryFilterItem } from '@teable/openapi';
import { useMemo } from 'react';
import type { IBaseFilterValue } from '../../../filter';
import { BaseFilter } from '../../../filter';
import type { IQueryEditorProps } from '../types';
import { FieldComponent } from './FieldComponent';
import { OperatorComponent } from './OperatorComponent';
import { ValueComponent } from './ValueComponent';

type IBaseFilterItem = {
  field: IBaseQueryFilterItem['column'];
  operator: IBaseQueryFilterItem['operator'];
  value: IBaseQueryFilterItem['value'];
  type: IBaseQueryFilterItem['type'];
};

export const QueryFilter = (props: IQueryEditorProps<IBaseQueryFilter>) => {
  const { value, onChange } = props;
  const filterValue = useMemo(() => {
    function transform(
      filter: IBaseQueryFilter | IBaseQueryFilterItem
    ): IBaseFilterValue<IBaseFilterItem> | IBaseFilterValue<IBaseFilterItem>['children'][number] {
      if ('filterSet' in filter) {
        return {
          conjunction: filter.conjunction,
          children: filter.filterSet.map(transform),
        };
      } else {
        return {
          field: filter.column,
          operator: filter.operator,
          value: filter.value,
          type: filter.type,
        };
      }
    }
    return value ? (transform(value) as IBaseFilterValue<IBaseFilterItem>) : undefined;
  }, [value]);

  const onInnerChange = (value: IBaseFilterValue<IBaseFilterItem>) => {
    if (!value.children.length) {
      return onChange(undefined);
    }
    function transform(
      filter:
        | IBaseFilterValue<IBaseFilterItem>
        | IBaseFilterValue<IBaseFilterItem>['children'][number]
    ): IBaseQueryFilter | IBaseQueryFilterItem {
      if ('children' in filter) {
        return {
          conjunction: filter.conjunction,
          filterSet: filter.children.map(transform),
        };
      } else {
        return {
          column: filter.field,
          operator: filter.operator,
          value: filter.value,
          type: filter.type,
        };
      }
    }
    onChange(transform(value) as IBaseQueryFilter);
  };

  return (
    <div>
      <BaseFilter<IBaseFilterItem>
        value={filterValue}
        onChange={onInnerChange}
        components={{
          FieldComponent: FieldComponent,
          OperatorComponent: OperatorComponent,
          ValueComponent: ValueComponent,
        }}
      />
    </div>
  );
};
