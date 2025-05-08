import { useMemo } from 'react';
import { useChatContext } from '../context/useChatContext';
import { useChatHistory } from './useChatHistory';

export const useActiveChat = (baseId: string) => {
  const { activeChatId } = useChatContext();
  const chatHistory = useChatHistory(baseId);

  return useMemo(() => {
    return chatHistory?.find((chat) => chat.id === activeChatId);
  }, [chatHistory, activeChatId]);
};
