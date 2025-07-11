import { LocalStorageKeys } from '@teable/sdk/config';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
interface IChatPanelState {
  isVisible: boolean;
  isExpanded: boolean;
  width?: string;
  toggleVisible: () => void;
  toggleExpanded: () => void;
  setExpanded: (expanded: boolean) => void;
  open: () => void;
  close: () => void;
}

export const useChatPanelStore = create<IChatPanelState>()(
  persist(
    (set) => ({
      isVisible: false,
      isExpanded: false,
      toggleVisible: () => set((state) => ({ isVisible: !state.isVisible, isExpanded: false })),
      toggleExpanded: () => set((state) => ({ isExpanded: !state.isExpanded })),
      setExpanded: (expanded: boolean) => set({ isExpanded: expanded }),
      open: () => set({ isVisible: true, isExpanded: false }),
      close: () => set({ isVisible: false, isExpanded: false }),
    }),
    {
      name: LocalStorageKeys.ChatPanel,
    }
  )
);
