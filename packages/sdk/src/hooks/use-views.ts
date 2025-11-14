import { useContext, useMemo } from 'react';
import { ViewContext } from '../context/view';

export function useViews() {
  const viewCtx = useContext(ViewContext);
  return useMemo(() => viewCtx?.views, [viewCtx?.views]);
}
