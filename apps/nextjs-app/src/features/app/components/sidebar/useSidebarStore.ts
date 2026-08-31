import { LocalStorageKeys } from '@teable/sdk';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SIDE_BAR_WIDTH } from '../toggle-side-bar/constant';

interface ISidebarState {
  isVisible: boolean;
  setVisible: (isVisible: boolean) => void;
  isNarrowScreenExpanded: boolean;
  setNarrowScreenExpanded: (isExpanded: boolean) => void;
  width: number;
  setWidth: (width: number) => void;
}

export const useSidebarStore = create<ISidebarState>()(
  persist(
    (set) => ({
      isVisible: true,
      isNarrowScreenExpanded: false,
      width: SIDE_BAR_WIDTH,
      setVisible: (isVisible: boolean) => set((state) => ({ ...state, isVisible })),
      setNarrowScreenExpanded: (isNarrowScreenExpanded: boolean) =>
        set((state) => ({ ...state, isNarrowScreenExpanded })),
      setWidth: (width: number) => set((state) => ({ ...state, width })),
    }),
    {
      name: LocalStorageKeys.Sidebar,
    }
  )
);
