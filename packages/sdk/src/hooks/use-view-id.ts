import { useContext } from 'react';
import { TableContext } from '../context/table';

// use current active view id
export function useViewId() {
  const { viewId } = useContext(TableContext);
  return viewId;
}
