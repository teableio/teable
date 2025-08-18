import type { IChatContext } from '@teable/openapi';
import { noop } from 'lodash';
import { useCallback, useState } from 'react';
import { ChatContext } from './ChatContext';

export const ChatProvider = ({ children }: { children: React.ReactNode }) => {
  const [context, setContext] = useState<IChatContext>({});
  const [activeChatId, setActiveChatId] = useState<string | undefined>(undefined);

  const updateContext = useCallback((context: IChatContext) => {
    setContext({
      ...context,
      tables: context?.tables?.length ? context?.tables : undefined,
    });
  }, []);

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
        setContext: updateContext,
        addToolResult: noop,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};
