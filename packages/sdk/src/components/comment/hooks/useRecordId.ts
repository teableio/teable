import { useContext } from 'react';
import { CommentContext } from '../context';

export const useRecordId = () => {
  return useContext(CommentContext).recordId;
};
