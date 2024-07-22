import type { IFilterSet } from '@teable/core';
import { FilterMain } from '@teable/sdk/components';
import { useFields } from '@teable/sdk/hooks';

export const FilterBuilder = ({
  filter,
  onChange,
}: {
  filter: IFilterSet | null;
  onChange: (filter: IFilterSet | null) => void;
}) => {
  const fields = useFields({ withHidden: true, withDenied: true });

  return <FilterMain filters={filter} onChange={onChange} fields={fields} />;
};
