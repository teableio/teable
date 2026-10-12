import type { RefObject } from 'react';
import { create } from 'zustand';

interface IToolBarState {
  filterRef: RefObject<HTMLButtonElement | null> | null;
  sortRef: RefObject<HTMLButtonElement | null> | null;
  groupRef: RefObject<HTMLButtonElement | null> | null;
  setFilterRef: (ref: RefObject<HTMLButtonElement | null>) => void;
  setSortRef: (ref: RefObject<HTMLButtonElement | null>) => void;
  setGroupRef: (ref: RefObject<HTMLButtonElement | null>) => void;
}

export const useToolBarStore = create<IToolBarState>((set) => ({
  filterRef: null,
  sortRef: null,
  groupRef: null,
  setFilterRef: (ref: RefObject<HTMLButtonElement | null>) => {
    set((state) => {
      return {
        ...state,
        filterRef: ref,
      };
    });
  },
  setSortRef: (ref: RefObject<HTMLButtonElement | null>) => {
    set((state) => {
      return {
        ...state,
        sortRef: ref,
      };
    });
  },
  setGroupRef: (ref: RefObject<HTMLButtonElement | null>) => {
    set((state) => {
      return {
        ...state,
        groupRef: ref,
      };
    });
  },
}));
