import { useFields } from '../../hooks';
import { FilterBase } from './FilterBase';
import type { IFilterProps } from './types';
import { useFilterNode } from './useFilterNode';

function Filter(props: IFilterProps) {
  const { onChange, filters, context, children, contentHeader, components } = props;
  const fields = useFields({ withHidden: true, withDenied: true });
  const { text, isActive } = useFilterNode(filters, fields);

  return (
    <FilterBase
      fields={fields}
      filters={filters}
      components={components}
      contentHeader={contentHeader}
      onChange={onChange}
      context={context}
    >
      {children?.(text, isActive)}
    </FilterBase>
  );
}

export { Filter };
