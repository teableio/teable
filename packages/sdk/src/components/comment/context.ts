import type { ListBaseCollaboratorVo } from '@teable/openapi';
import React from 'react';

export interface ICommentContext {
  collaborators: ListBaseCollaboratorVo;
  recordId?: string;
}

export const CommentContext = React.createContext<ICommentContext>({
  collaborators: [],
});
