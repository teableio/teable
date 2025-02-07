import { LocalStorageKeys } from '@teable/sdk/config';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ILockedViewTipState {
  visible: boolean;
  setVisible: (visible: boolean) => void;
}

export const useLockedViewTipStore = create<ILockedViewTipState>()(
  persist(
    (set) => ({
      visible: true,
      setVisible: (visible) => set({ visible }),
    }),
    {
      name: LocalStorageKeys.LockedViewTipVisible,
    }
  )
);
