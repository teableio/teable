import { TableContext } from '../context/table';
import { useContext } from 'react';

export function useViewId() {
  const { viewId } = useContext(TableContext);
  return viewId;
}
