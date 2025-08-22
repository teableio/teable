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
  expand: () => void;
  unExpand: () => void;
  open: () => void;
  close: () => void;
  setVisible: (visible: boolean) => void;
}

export const useChatPanelStore = create<IChatPanelState>()(
  persist(
    (set) => ({
      isVisible: false,
      isExpanded: true,
      toggleVisible: () => set((state) => ({ isVisible: !state.isVisible, isExpanded: false })),
      toggleExpanded: () => set((state) => ({ isExpanded: !state.isExpanded })),
      setExpanded: (expanded: boolean) => set({ isExpanded: expanded }),
      expand: () => set({ isExpanded: true, isVisible: true }),
      unExpand: () => set({ isExpanded: false, isVisible: true }),
      setVisible: (visible: boolean) => set({ isVisible: visible }),
      open: () => set({ isVisible: true, isExpanded: false }),
      close: () => set({ isVisible: false, isExpanded: false }),
    }),
    {
      name: LocalStorageKeys.ChatPanel,
    }
  )
);
