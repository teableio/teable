import { useContext } from 'react';
import { CommentListContext } from './context';

export const useIsMe = () => {
  const { isMe = false } = useContext(CommentListContext);
  return isMe;
};
