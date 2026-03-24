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
  chatMode: 'general' | 'agent' | 'cuppyclaw';
  close: () => void;
  open: () => void;
  expand: () => void;
  toggleVisible: () => void;
  toggleExpanded: () => void;
  setChatMode: (mode: 'general' | 'agent' | 'cuppyclaw') => void;
  openAgent: () => void;
  openCuppyClaw: () => void;
}

export const useChatPanelStore = create<IChatPanelState>()(
  persist(
    (set) => ({
      status: 'open',
      chatMode: 'general' as const,
      close: () =>
        set((state) => ({
          status: 'close',
          chatMode: state.chatMode === 'cuppyclaw' ? 'general' : state.chatMode,
        })),
      open: () => set({ status: 'open' }),
      expand: () => set({ status: 'expanded' }),
      toggleVisible: () =>
        set((state) => ({
          status: state.status !== 'close' ? 'close' : 'open',
          chatMode:
            state.status !== 'close' && state.chatMode === 'cuppyclaw' ? 'general' : state.chatMode,
        })),
      toggleExpanded: () =>
        set((state) => ({ status: state.status === 'expanded' ? 'open' : 'expanded' })),
      setChatMode: (mode: 'general' | 'agent' | 'cuppyclaw') => set({ chatMode: mode }),
      openAgent: () => set({ status: 'open', chatMode: 'agent' }),
      openCuppyClaw: () => set({ status: 'open', chatMode: 'cuppyclaw' }),
    }),
    {
      name: LocalStorageKeys.ChatPanel,
      // Never persist cuppyclaw mode — it must be entered explicitly via sidebar button
      partialize: (state) => ({
        status: state.status,
        chatMode: state.chatMode === 'cuppyclaw' ? 'general' : state.chatMode,
      }),
    }
  )
);
