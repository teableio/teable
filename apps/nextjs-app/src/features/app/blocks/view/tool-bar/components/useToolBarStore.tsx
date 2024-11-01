import type { RefObject } from 'react';
import { create } from 'zustand';

interface IToolBarState {
  filterRef: RefObject<HTMLButtonElement> | null;
  sortRef: RefObject<HTMLButtonElement> | null;
  groupRef: RefObject<HTMLButtonElement> | null;
  setFilterRef: (ref: RefObject<HTMLButtonElement>) => void;
  setSortRef: (ref: RefObject<HTMLButtonElement>) => void;
  setGroupRef: (ref: RefObject<HTMLButtonElement>) => void;
}

export const useToolBarStore = create<IToolBarState>((set) => ({
  filterRef: null,
  sortRef: null,
  groupRef: null,
  setFilterRef: (ref: RefObject<HTMLButtonElement>) => {
    set((state) => {
      return {
        ...state,
        filterRef: ref,
      };
    });
  },
  setSortRef: (ref: RefObject<HTMLButtonElement>) => {
    set((state) => {
      return {
        ...state,
        sortRef: ref,
      };
    });
  },
  setGroupRef: (ref: RefObject<HTMLButtonElement>) => {
    set((state) => {
      return {
        ...state,
        groupRef: ref,
      };
    });
  },
}));
