import { useMemo } from 'react';
import { useChatStore } from '../store/useChatStore';
import { useChatHistory } from './useChatHistory';

export const useActiveChat = (baseId: string) => {
  const { activeChatId } = useChatStore();
  const chatHistory = useChatHistory(baseId);

  return useMemo(() => {
    return chatHistory?.find((chat) => chat.id === activeChatId);
  }, [chatHistory, activeChatId]);
};
