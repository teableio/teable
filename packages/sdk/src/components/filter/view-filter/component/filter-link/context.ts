import React from 'react';

export interface ILinkContext {
  isLoading: boolean;
  data:
    | {
        tableId: string;
        data: Record<string, string | undefined>;
      }[]
    | undefined;
}

export interface IFilterLinkContext {
  context?: ILinkContext;
}

export const FilterLinkContext: React.Context<IFilterLinkContext> =
  React.createContext<IFilterLinkContext>({});
