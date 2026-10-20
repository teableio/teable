import { BaseNodeResourceType } from '@teable/openapi';
import { useBaseId } from '@teable/sdk/hooks';
import { useRouter } from 'next/router';
import { createContext, useCallback, useContext } from 'react';
import { getNodeUrl } from '../blocks/base/base-node/hooks/helper';
import { useShareUrlPrefix } from '../context/ShareContext';

export interface IResourceNavigation {
  navigateToView: (params: { tableId: string; viewId: string }) => void;
}

/**
 * On a table page a view switch is a shallow route push. Inside the chat page's Output pane
 * the table is not on its route, so the host takes the switch and moves its own tab instead.
 */
export const ResourceNavigationContext = createContext<IResourceNavigation | undefined>(undefined);

export const useNavigateToView = () => {
  const override = useContext(ResourceNavigationContext);
  const router = useRouter();
  const baseId = useBaseId() as string;
  const shareUrlPrefix = useShareUrlPrefix();
  return useCallback(
    (tableId: string, viewId: string, options: { replace?: boolean } = {}) => {
      if (override) {
        override.navigateToView({ tableId, viewId });
        return;
      }
      const url = getNodeUrl({
        baseId,
        resourceType: BaseNodeResourceType.Table,
        resourceId: tableId,
        viewId,
        urlPrefix: shareUrlPrefix,
      });
      if (!url) return;
      // replace, not push, when the current entry must not come back (a deleted view)
      if (options.replace) {
        router.replace(url, undefined, { shallow: true });
      } else {
        router.push(url, undefined, { shallow: true });
      }
    },
    [override, baseId, router, shareUrlPrefix]
  );
};
