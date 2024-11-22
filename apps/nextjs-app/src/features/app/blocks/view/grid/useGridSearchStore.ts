import type { IGridRef } from '@teable/sdk';
import { noop } from 'lodash';
import { create } from 'zustand';

interface IGridRefState {
  gridRef: React.RefObject<IGridRef> | null;
  setGridRef: (ref: React.RefObject<IGridRef>) => void;
  searchCursor: [number, number] | null;
  setSearchCursor: (cell: [number, number] | null) => void;
  resetSearchHandler: () => void;
  setResetSearchHandler: (fn: () => void) => void;
}

export const useGridSearchStore = create<IGridRefState>((set) => ({
  gridRef: null,
  searchCursor: null,
  resetSearchHandler: noop,
  setResetSearchHandler: (fn: () => void) => {
    set((state) => {
      return {
        ...state,
        resetSearchHandler: fn,
      };
    });
  },
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
