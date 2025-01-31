import { usePersonalView, useTablePermission, useView } from '@teable/sdk/hooks';

export const useViewConfigurable = () => {
  const view = useView();
  const permission = useTablePermission();
  const { isPersonalView } = usePersonalView();

  return {
    isViewConfigurable: (!view?.isLocked && permission['view|update']) || isPersonalView,
  };
};
