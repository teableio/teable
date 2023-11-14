import { ViewType } from '@teable-group/core';
import { useIsHydrated } from '@teable-group/sdk/hooks';
import { useContext } from 'react';
import { FormView } from './component/FormView';
import { ShareViewPageContext } from './ShareViewPageContext';

export const ShareView = () => {
  const isHydrated = useIsHydrated();
  const { view } = useContext(ShareViewPageContext);
  const viewType = view?.type;

  if (!isHydrated) {
    return <div className="w-full grow overflow-hidden pl-2" />;
  }

  const getViewComponent = () => {
    // eslint-disable-next-line sonarjs/no-small-switch
    switch (viewType) {
      case ViewType.Form:
        return <FormView />;
      default:
        return null;
    }
  };

  return <div className="h-screen w-full">{getViewComponent()}</div>;
};
