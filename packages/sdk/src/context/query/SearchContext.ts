import type { IQueryBaseRo } from '@teable/openapi';
import React from 'react';
export interface ISearchContext {
  fieldId?: string;
  value?: string;
  searchQuery?: IQueryBaseRo['search'];
  setFieldId?: (fieldId: string) => void;
  setValue?: (value: string | undefined) => void;
  reset?: () => void;
  hideNotMatchRow?: boolean;
  setHideNotMatchRow?: (hideNotMatchRow: boolean) => void;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const SearchContext = React.createContext<ISearchContext>({});
