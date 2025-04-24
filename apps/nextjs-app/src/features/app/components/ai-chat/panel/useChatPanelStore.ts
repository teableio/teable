import { LocalStorageKeys } from '@teable/sdk/config';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
interface IChatPanelState {
  isVisible: boolean;
  width?: string;
  toggleVisible: () => void;
  open: () => void;
  close: () => void;
  updateWidth: (width: string) => void;
}

export const useChatPanelStore = create<IChatPanelState>()(
  persist(
    (set) => ({
      isVisible: false,
      toggleVisible: () => set((state) => ({ isVisible: !state.isVisible })),
      open: () => set({ isVisible: true }),
      close: () => set({ isVisible: false }),
      updateWidth: (width: string) => set({ width }),
    }),
    {
      name: LocalStorageKeys.ChatPanel,
    }
  )
);
