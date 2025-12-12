import { create } from 'zustand';

interface ISettingState {
  tab?: 'profile' | 'system' | 'notifications' | 'integration';
  setTab: (tab: 'profile' | 'system' | 'notifications' | 'integration') => void;
  open: boolean;
  setOpen: (open: boolean, tab?: 'profile' | 'system' | 'notifications' | 'integration') => void;
}

export const useSettingStore = create<ISettingState>((set) => ({
  open: false,
  setOpen: (open: boolean, tab?: 'profile' | 'system' | 'notifications' | 'integration') => {
    set((state) => {
      return {
        ...state,
        open,
        tab,
      };
    });
  },
  setTab: (tab: 'profile' | 'system' | 'notifications' | 'integration') => {
    set((state) => {
      return {
        ...state,
        tab,
      };
    });
  },
}));
