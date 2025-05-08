import type { IChatContext } from '@teable/openapi';
import { useCallback, useState } from 'react';
import { ChatContext } from './ChatContext';

export const ChatProvider = ({ children }: { children: React.ReactNode }) => {
  const [context, setContext] = useState<IChatContext>({});
  const [activeChatId, setActiveChatId] = useState<string | undefined>(undefined);

  const clearActiveChatId = useCallback(() => {
    setActiveChatId(undefined);
  }, []);

  return (
    <ChatContext.Provider
      value={{
        activeChatId,
        setActiveChatId,
        clearActiveChatId,
        context,
        setContext,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};
