import { useContext } from 'react';
import { CommentContext } from '../context';

export function useBaseId() {
  return useContext(CommentContext).baseId;
}
