import React from 'react';

export interface ILinkFilterContext {
  selectedRecordIds?: string[];
  filterLinkCellSelected?: [string, string] | string;
  filterLinkCellCandidate?: [string, string] | string;
  setSelectedRecordIds?: (selected: string[]) => void;
  setLinkCellSelected?: (selected: string[]) => void;
  setLinkCellCandidate?: (candidate: string[]) => void;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LinkFilterContext = React.createContext<ILinkFilterContext>({});
