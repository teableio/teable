import { useContext } from 'react';
import { AnchorContext, ViewContext } from '../context';

export function useView(viewId?: string) {
  const { viewId: activeViewId } = useContext(AnchorContext);
  const { views } = useContext(ViewContext);
  return views.find((view) => view.id === (viewId ?? activeViewId));
}
