import { noop } from 'lodash';
import { useContext } from 'react';
import { SearchContext } from '../context/query';

export function useSearch() {
  const search = useContext(SearchContext);

  return {
    ...search,
    // search only affects which rows a query returns when hideNotMatchRow
    // (search[2]) is set; a display-only search must not be sent to row
    // queries since cell highlighting is computed locally on the client
    filteringSearchQuery: search.searchQuery?.[2] ? search.searchQuery : undefined,
    setFieldId: search.setFieldId || noop,
    setValue: search.setValue || noop,
    reset: search.reset || noop,
    setHideNotMatchRow: search.setHideNotMatchRow || noop,
  };
}
