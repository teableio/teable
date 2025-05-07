import { LocalStorageKeys } from '@teable/sdk/config';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
interface IChatState {
  modelKey?: string;
  setModelKey: (modelKey: string) => void;
  activeChatId?: string;
  setActiveChatId: (chatId: string) => void;
  clearActiveChatId: () => void;
}

export const useChatStore = create<IChatState>()(
  persist(
    (set) => ({
      activeChatId: undefined,
      modelKey: undefined,
      setActiveChatId: (chatId: string) => set({ activeChatId: chatId }),
      clearActiveChatId: () => set({ activeChatId: undefined }),
      setModelKey: (modelKey: string) => set({ modelKey }),
    }),
    {
      name: LocalStorageKeys.Chat,
    }
  )
);
