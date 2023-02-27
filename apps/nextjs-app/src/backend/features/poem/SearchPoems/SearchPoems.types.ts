import type { UnPromisify } from '@teable-group/core';
import type { SearchPoemsQuery } from './SearchPoemsQuery';

export interface ISearchPoemsParams {
  limit?: number;
  offset?: number;
}

export type ISearchPoems = UnPromisify<ReturnType<SearchPoemsQuery['execute']>>;
