import { LocalStorageKeys } from '@teable/sdk/config';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface IChatPanelState {
  status: 'open' | 'close' | 'expanded';
  close: () => void;
  open: () => void;
  expand: () => void;
  toggleVisible: () => void;
  toggleExpanded: () => void;
}

export const useChatPanelStore = create<IChatPanelState>()(
  persist(
    (set) => ({
      status: 'close',
      close: () => set({ status: 'close' }),
      open: () => set({ status: 'open' }),
      expand: () => set({ status: 'expanded' }),
      toggleVisible: () =>
        set((state) => ({ status: state.status !== 'close' ? 'close' : 'open' })),
      toggleExpanded: () =>
        set((state) => ({ status: state.status === 'expanded' ? 'open' : 'expanded' })),
    }),
    {
      name: LocalStorageKeys.ChatPanel,
    }
  )
);
