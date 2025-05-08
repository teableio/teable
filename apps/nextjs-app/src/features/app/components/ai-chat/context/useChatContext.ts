import { useContext } from 'react';
import { ChatContext } from './ChatContext';

export const useChatContext = () => {
  return useContext(ChatContext);
};
