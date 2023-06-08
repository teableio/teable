import { useContext } from 'react';
import { AnchorContext } from '../context';

export function useTableId() {
  const { tableId } = useContext(AnchorContext);
  return tableId;
}
