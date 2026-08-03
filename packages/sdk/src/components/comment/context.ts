import React from 'react';

export interface ICommentContext {
  baseId: string;
  recordId?: string;
}

export const CommentContext = React.createContext<ICommentContext>({ baseId: '' });
