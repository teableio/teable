import { useContext, useMemo } from 'react';
import { useBuildBaseAgentStore } from '../components/grid-enhancements/store/useBuildBaseAgentStore';
import { ViewContext } from '../context/view';

export function useViews() {
  const viewCtx = useContext(ViewContext);
  const { displayViews, building } = useBuildBaseAgentStore();
  return useMemo(() => {
    if (building) {
      return viewCtx?.views.filter((view) => displayViews.includes(view.id));
    }
    return viewCtx?.views;
  }, [viewCtx?.views, displayViews, building]);
}
