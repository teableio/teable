import { usePersonalView, useTablePermission } from '@teable/sdk/hooks';

export const useViewConfigurable = () => {
  const permission = useTablePermission();
  const { isPersonalView } = usePersonalView();

  return {
    isViewConfigurable: permission['view|update'] || isPersonalView,
  };
};
