import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { SearchContext } from './SearchContext';

export interface ISearchProviderProps {
  children?: ReactNode;
}

export const SearchProvider: React.FC<ISearchProviderProps> = ({ children }) => {
  const [fieldId, setFieldId] = useState<string | undefined>();
  const [value, setValue] = useState<string | undefined>();

  const reset = useCallback(() => {
    setFieldId(undefined);
    setValue(undefined);
  }, []);

  const searchQuery = useMemo<[string, string] | [string] | undefined>(() => {
    if (value && fieldId) {
      if (fieldId === 'all_fields') {
        return [value];
      }
      return [value, fieldId];
    }
    return undefined;
  }, [fieldId, value]);

  return (
    <SearchContext.Provider value={{ value, fieldId, searchQuery, setFieldId, setValue, reset }}>
      {children}
    </SearchContext.Provider>
  );
};
