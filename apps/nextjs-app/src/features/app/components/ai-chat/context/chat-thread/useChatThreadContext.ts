import { useContext } from 'react';
import { ChatThreadContext } from './ChatThreadContext';

export const useChatThreadContext = () => {
  return useContext(ChatThreadContext);
};
