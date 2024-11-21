import type { IGridRef } from '@teable/sdk';
import { create } from 'zustand';

interface IGridRefState {
  gridRef: React.RefObject<IGridRef> | null;
  setGridRef: (ref: React.RefObject<IGridRef>) => void;
  searchCursor: [number, number] | null;
  setSearchCursor: (cell: [number, number] | null) => void;
}

export const useGridSearchStore = create<IGridRefState>((set) => ({
  gridRef: null,
  searchCursor: null,
  setGridRef: (ref: React.RefObject<IGridRef>) => {
    set((state) => {
      return {
        ...state,
        gridRef: ref,
      };
    });
  },
  setSearchCursor: (cell: [number, number] | null) => {
    set((state) => {
      return {
        ...state,
        searchCursor: cell,
      };
    });
  },
}));
