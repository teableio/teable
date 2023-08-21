import { useContext } from 'react';
import { AnchorContext, ViewContext } from '../context';

// use current active view id
export function useViewId(): string | undefined {
  const { viewId } = useContext(AnchorContext);
  const { views } = useContext(ViewContext);
  return viewId || views[0]?.id;
}
