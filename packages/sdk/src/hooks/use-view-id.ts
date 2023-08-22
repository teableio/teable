import { useContext } from 'react';
import { AnchorContext } from '../context';

// use current active view id
export function useViewId() {
  const { viewId } = useContext(AnchorContext);
  return viewId;
}
