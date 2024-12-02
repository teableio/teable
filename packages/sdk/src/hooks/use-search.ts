import { noop } from 'lodash';
import { useContext } from 'react';
import { SearchContext } from '../context/query';

export function useSearch() {
  const search = useContext(SearchContext);

  return {
    ...search,
    setFieldId: search.setFieldId || noop,
    setValue: search.setValue || noop,
    reset: search.reset || noop,
    setHideNotMatchRow: search.setHideNotMatchRow || noop,
  };
}
