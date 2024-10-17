import { createContext } from 'react';
interface ICommentListProps {
  isMe: boolean;
}

export const CommentListContext = createContext<ICommentListProps>({
  isMe: false,
});
