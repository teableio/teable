import { useContext } from 'react';
import { AnchorContext, ViewContext } from '../context';

export function useView(viewId?: string) {
  const { viewId: activeViewId } = useContext(AnchorContext);
  const viewCtx = useContext(ViewContext);
  if (!viewCtx) {
    return;
  }
  return viewCtx.views.find((view) => view.id === (viewId ?? activeViewId));
}
