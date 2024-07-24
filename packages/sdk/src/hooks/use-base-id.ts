import { useContext } from 'react';
import { AnchorContext } from '../context';

export function useBaseId() {
  const { baseId } = useContext(AnchorContext);
  return baseId;
}
