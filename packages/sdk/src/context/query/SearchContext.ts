import React from 'react';

export interface ISearchContext {
  fieldId?: string;
  value?: string;
  searchQuery?: [string, string] | [string];
  setFieldId?: (fieldId: string) => void;
  setValue?: (value: string | undefined) => void;
  reset?: () => void;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const SearchContext = React.createContext<ISearchContext>({});
