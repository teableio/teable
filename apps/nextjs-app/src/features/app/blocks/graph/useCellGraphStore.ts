import { create } from 'zustand';

interface ICellGraphState {
  graphOpen: boolean;
  openGraph: () => void;
  closeGraph: () => void;
  toggleGraph: () => void;
}

export const useCellGraphStore = create<ICellGraphState>((set) => ({
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
