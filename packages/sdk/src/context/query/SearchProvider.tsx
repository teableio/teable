import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { SearchContext } from './SearchContext';

export interface ISearchProviderProps {
  children?: ReactNode;
}

export const SearchProvider: React.FC<ISearchProviderProps> = ({ children }) => {
  const [fieldId, setFieldId] = useState<string | undefined>();
  const [value, setValue] = useState<string | undefined>();
  const [hideNotMatchRow, setHideNotMatchRow] = useState<boolean>(false);

  const reset = useCallback(() => {
    setFieldId(undefined);
    setValue(undefined);
  }, []);

  const searchQuery = useMemo<[string, string, boolean] | undefined>(() => {
    if (value && fieldId) {
      if (fieldId === 'all_fields') {
        // url deal undefined will throw it, so use '' instead
        return [value, '', !!hideNotMatchRow];
      }
      return [value, fieldId, !!hideNotMatchRow];
    }
    return undefined;
  }, [fieldId, value, hideNotMatchRow]);

  return (
    <SearchContext.Provider
      value={{
        value,
        fieldId,
        searchQuery,
        setFieldId,
        setValue,
        reset,
        hideNotMatchRow,
        setHideNotMatchRow,
      }}
    >
      {children}
    </SearchContext.Provider>
  );
};
