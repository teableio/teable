import { LocalStorageKeys } from '@teable/sdk';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SIDE_BAR_WIDTH } from '../toggle-side-bar/constant';

interface ISidebarState {
  isVisible: boolean;
  setVisible: (isVisible: boolean) => void;
  width: number;
  setWidth: (width: number) => void;
}

export const useSidebarStore = create<ISidebarState>()(
  persist(
    (set) => ({
      isVisible: true,
      width: SIDE_BAR_WIDTH,
      setVisible: (isVisible: boolean) => set((state) => ({ ...state, isVisible })),
      setWidth: (width: number) => set((state) => ({ ...state, width })),
    }),
    {
      name: LocalStorageKeys.Sidebar,
    }
  )
);
