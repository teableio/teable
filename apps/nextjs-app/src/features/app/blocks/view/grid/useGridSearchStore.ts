import type { IGridRef } from '@teable/sdk';
import { create } from 'zustand';

interface IGridRefState {
  gridRef: React.RefObject<IGridRef> | null;
  setGridRef: (ref: React.RefObject<IGridRef>) => void;
}

export const useGridSearchStore = create<IGridRefState>((set) => ({
  gridRef: null,
  setGridRef: (ref: React.RefObject<IGridRef>) => {
    set((state) => {
      return {
        ...state,
        gridRef: ref,
      };
    });
  },
}));
