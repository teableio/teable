import { SearchInput } from '@teable/sdk/components';
import { useSearch } from '@teable/sdk/hooks';
import { isEqual } from 'lodash';
import { useEffect } from 'react';

export const SearchBuilder = ({
  search,
  onChange,
}: {
  search?: [string, string] | [string];
  onChange: (search?: [string, string] | [string]) => void;
}) => {
  const { searchQuery } = useSearch();

  useEffect(() => {
    if (!isEqual(searchQuery, search)) {
      onChange(searchQuery);
    }
  }, [onChange, search, searchQuery]);

  return <SearchInput className="w-80" />;
};
