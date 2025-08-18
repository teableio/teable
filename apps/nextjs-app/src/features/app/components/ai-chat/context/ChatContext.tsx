import type { IChatContext } from '@teable/openapi';
import { noop } from 'lodash';
import { createContext } from 'react';

export const ChatContext = createContext<{
  activeChatId?: string;
  setActiveChatId: (chatId: string) => void;
  clearActiveChatId: () => void;
  context?: IChatContext;
  setContext: (context: IChatContext) => void;
  addToolResult: (toolResult: { toolCallId: string; result: unknown }) => void;
}>({
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setContext: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setActiveChatId: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  clearActiveChatId: () => {},
  addToolResult: noop,
});
