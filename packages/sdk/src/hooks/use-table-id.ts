import { useContext } from 'react';
import { AnchorContext } from '../context/anchor/AnchorContext';

export function useTableId() {
  const { tableId } = useContext(AnchorContext);
  return tableId;
}
