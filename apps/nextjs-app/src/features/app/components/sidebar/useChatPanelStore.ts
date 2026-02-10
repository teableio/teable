import { LocalStorageKeys } from '@teable/sdk/config';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Chat panel visibility states:
 * - 'open'     — panel visible at normal width (side panel)
 * - 'close'    — panel hidden, only cuppy icon shown
 * - 'expanded' — panel takes up most of the screen
 *
 * State is persisted to localStorage so the user's preference
 * survives page navigations and browser refreshes.
 *
 * Default is 'open' — first-time visitors see the panel.
 * Once a user explicitly closes the panel, 'close' is persisted
 * and respected on subsequent visits.
 *
 * NOTE: Some pages force-open the panel for specific UX flows:
 * - AppPage calls open() because app builder requires the chat panel
 * - ChatContainer calls expand() for the empty-base welcome screen
 * These are intentional overrides, not default-state logic.
 */
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
      status: 'open',
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
