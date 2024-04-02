import { create } from 'zustand';

interface ISettingState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useSettingStore = create<ISettingState>((set) => ({
  open: false,
  setOpen: (open: boolean) => {
    set((state) => {
      return {
        ...state,
        open,
      };
    });
  },
}));
