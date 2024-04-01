import { useFields } from '../../hooks';
import { FilterBase } from './FilterBase';
import type { IFilterProps } from './types';
import { useFilterNode } from './useFilterNode';

function Filter(props: IFilterProps) {
  const { onChange, filters, children, contentHeader, components } = props;
  const fields = useFields();
  const { text, isActive } = useFilterNode(filters);

  return (
    <FilterBase
      fields={fields}
      filters={filters}
      components={components}
      contentHeader={contentHeader}
      onChange={onChange}
    >
      {children?.(text, isActive)}
    </FilterBase>
  );
}

export { Filter };
