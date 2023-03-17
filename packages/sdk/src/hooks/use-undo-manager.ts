import { useContext } from 'react';
import { AppContext } from '../context';

export function useUndoManager() {
  const { undoManager } = useContext(AppContext);
  return undoManager;
}
