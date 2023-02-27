import { TableContext } from '../context/table';
import { useContext } from 'react';

export function useActiveViewId() {
  const { activeViewId } = useContext(TableContext);
  return activeViewId;
}
