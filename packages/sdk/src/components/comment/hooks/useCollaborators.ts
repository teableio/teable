import { useContext } from 'react';
import { CommentContext } from '../context';

export const useCollaborators = () => {
  return useContext(CommentContext).collaborators || [];
};
