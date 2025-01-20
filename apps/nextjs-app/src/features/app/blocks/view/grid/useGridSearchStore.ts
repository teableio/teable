import type { IGridRef, IRecordIndexMap } from '@teable/sdk';
import { noop } from 'lodash';
import { create } from 'zustand';

interface IGridRefState {
  gridRef: React.RefObject<IGridRef> | null;
  setGridRef: (ref: React.RefObject<IGridRef>) => void;
  searchCursor: [number, number] | null;
  setSearchCursor: (cell: [number, number] | null) => void;
  resetSearchHandler: () => void;
  setResetSearchHandler: (fn: () => void) => void;
  recordMap: IRecordIndexMap | null;
  setRecordMap: (recordMap: IRecordIndexMap | null) => void;
}

export const useGridSearchStore = create<IGridRefState>((set) => ({
  gridRef: null,
  searchCursor: null,
  recordMap: null,
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
  setRecordMap: (recordMap: IRecordIndexMap | null) => {
    set((state) => {
      return {
        ...state,
        recordMap: recordMap,
      };
    });
  },
}));
