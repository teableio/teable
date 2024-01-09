import { useFields } from '../../hooks';
import { FilterBase } from './FilterBase';
import type { IFilterProps } from './types';
import { useFilterNode } from './useFilterNode';

function Filter(props: IFilterProps) {
  const { onChange, filters, children, contentHeader } = props;
  const fields = useFields();
  const { text, isActive } = useFilterNode(filters);

  return (
    <FilterBase filters={filters} fields={fields} onChange={onChange} contentHeader={contentHeader}>
      {children?.(text, isActive)}
    </FilterBase>
  );
}

export { Filter };
