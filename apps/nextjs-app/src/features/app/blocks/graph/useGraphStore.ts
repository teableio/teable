import { create } from 'zustand';

interface IGridState {
  graphOpen: boolean;
  openGraph: () => void;
  closeGraph: () => void;
  toggleGraph: () => void;
}

export const useGraphStore = create<IGridState>((set) => ({
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
