import React from 'react';
import type { LinkListType } from '../../components/editor/link/interface';

export interface ILinkFilterContext {
  selectedRecordIds?: string[];
  filterLinkCellSelected?: [string, string] | string;
  filterLinkCellCandidate?: [string, string] | string;
  listType?: LinkListType;
  setSelectedRecordIds?: (selected: string[]) => void;
  setLinkCellSelected?: (selected: string[]) => void;
  setLinkCellCandidate?: (candidate: string[]) => void;
  setListType?: (listType: LinkListType) => void;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LinkFilterContext = React.createContext<ILinkFilterContext>({});
