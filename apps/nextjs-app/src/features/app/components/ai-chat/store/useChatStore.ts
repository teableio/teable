import type { UseChatHelpers } from '@ai-sdk/react';
import { LocalStorageKeys } from '@teable/sdk/config';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
interface IChatState {
  modelKey?: string;
  setModelKey: (modelKey: string) => void;
  messages: UseChatHelpers['messages'];
  setMessages: (messages: UseChatHelpers['messages']) => void;
}

export const useChatStore = create<IChatState>()(
  persist(
    (set) => ({
      activeChatId: undefined,
      modelKey: undefined,
      setModelKey: (modelKey: string) => set({ modelKey }),
      messages: [],
      setMessages: (messages) => set({ messages }),
    }),
    {
      name: LocalStorageKeys.Chat,
    }
  )
);
