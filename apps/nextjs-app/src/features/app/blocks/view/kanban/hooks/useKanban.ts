import { useContext } from 'react';
import { KanbanContext } from '../context';

export const useKanban = () => {
  return useContext(KanbanContext);
};
