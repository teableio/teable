import { useCallback, useContext } from 'react';
import { type IProxyPersonalView } from '../context';
import { PersonalViewContext } from '../context/view/PersonalViewContext';
import { useResolvedPersonalViewStore } from '../context/view/store';
import { generatePersonalViewProps } from '../utils/personalView';
import { useView } from './use-view';

export const usePersonalView = () => {
  const { isPersonalView, personalViewMap, personalViewCommonQuery, personalViewAggregationQuery } =
    useContext(PersonalViewContext);
  const { removePersonalView, setPersonalViewMap } = useResolvedPersonalViewStore();

  const view = useView();
  const viewId = view?.id ?? '';

  const closePersonalView = () => {
    removePersonalView(viewId);
  };

  const openPersonalView = useCallback(() => {
    setPersonalViewMap(viewId, (prev) => {
      return { ...prev, ...generatePersonalViewProps(view) };
    });
  }, [viewId, setPersonalViewMap, view]);

  const syncViewProperties = async () => {
    await (view as IProxyPersonalView)?.syncViewProperties?.();
  };

  return {
    isPersonalView,
    personalViewMap,
    personalViewCommonQuery,
    personalViewAggregationQuery,
    openPersonalView,
    closePersonalView,
    syncViewProperties,
  };
};
