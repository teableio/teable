import React from 'react';

export interface ILinkFilterContext {
  filterLinkCellSelected?: [string, string] | string;
  filterLinkCellCandidate?: [string, string] | string;
  setLinkCellCandidate?: (candidate: string[]) => void;
  setLinkCellSelected?: (selected: string[]) => void;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LinkFilterContext = React.createContext<ILinkFilterContext>({});
