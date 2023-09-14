import { create } from 'zustand';

interface IGridViewState {
  graphOpen: boolean;
  openGraph: () => void;
  closeGraph: () => void;
  toggleGraph: () => void;
}

export const useGraphStore = create<IGridViewState>((set) => ({
  graphOpen: false,
  toggleGraph: () => {
    set((state) => {
      return {
        ...state,
        graphOpen: !state.graphOpen,
      };
    });
  },
  openGraph: () => {
    set((state) => {
      return {
        ...state,
        graphOpen: true,
      };
    });
  },
  closeGraph: () => {
    set((state) => {
      return {
        ...state,
        graphOpen: false,
      };
    });
  },
}));
