import { ShareViewContext } from '@teable/sdk/context';
import { usePersonalView, useTablePermission } from '@teable/sdk/hooks';
import { useContext } from 'react';

export const useViewConfigurable = () => {
  const permission = useTablePermission();
  const { isPersonalView } = usePersonalView();
  const { shareId } = useContext(ShareViewContext) ?? {};
  const isShareView = Boolean(shareId);

  return {
    isViewConfigurable: permission['view|update'] || isPersonalView || isShareView,
  };
};
