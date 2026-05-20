import type { QueryClient } from '@tanstack/react-query';
import type { IBaseNodeVo } from '@teable/openapi';
import { BaseNodeResourceType } from '@teable/openapi';
import { getNodeUrl } from '@/features/app/blocks/base/base-node/hooks/helper';
import type { SSRResult, ISSRContext } from './types';

export const redirect = (destination: string): SSRResult => ({
  redirect: { destination, permanent: false },
});

interface IDefaultNodeOptions {
  filterNode?: (node: IBaseNodeVo) => boolean;
}

/**
 * Get the default node URL when a specific node is not found
 * This function will redirect to the first available non-folder node in the base
 */
export const getDefaultNodeUrl = async (
  ctx: ISSRContext,
  options?: IDefaultNodeOptions
): Promise<string | null> => {
  const { ssrApi, baseId } = ctx;

  try {
    const [lastVisitNode, nodes] = await Promise.all([
      ssrApi.getUserLastVisitBaseNode({ parentResourceId: baseId }),
      ssrApi.getBaseNodeList(baseId),
    ]);
    const availableNodes = options?.filterNode ? nodes.filter(options.filterNode) : nodes;

    // Try to find the last visited node, but skip if it's a folder
    let findNode = availableNodes.find(
      (n) =>
        n.resourceId === lastVisitNode?.resourceId && n.resourceType !== BaseNodeResourceType.Folder
    );

    // If not found, find the first non-folder node
    if (!findNode) {
      findNode = availableNodes.find((n) => n.resourceType !== BaseNodeResourceType.Folder);
    }

    if (findNode) {
      const url = getNodeUrl({
        baseId,
        resourceType: findNode.resourceType,
        resourceId: findNode.resourceId,
      });
      return url?.pathname || null;
    }
  } catch (error) {
    console.error('Failed to get default node:', error);
  }

  return null;
};

/**
 * Validate if a resource exists in the list, redirect to default node if not found
 * @param ctx - SSR context
 * @param options - Validation options
 * @returns SSRResult if resource not found, null if resource exists
 */
export const validateResourceExists = async <T>(
  ctx: ISSRContext,
  options: {
    resourceId: string;
    queryKey: readonly unknown[];
    fetchList: (queryClient: QueryClient) => Promise<T[]>;
    extractIds: (list: T[]) => string[];
    filterDefaultNode?: (node: IBaseNodeVo, resourceIds: Set<string>) => boolean;
  }
): Promise<SSRResult | null> => {
  const { queryClient } = ctx;

  const list = await queryClient.fetchQuery({
    queryKey: options.queryKey,
    queryFn: () => options.fetchList(queryClient),
  });

  const ids = options.extractIds(list);
  const resourceIds = new Set(ids);

  // If resource doesn't exist, redirect to default node
  if (!resourceIds.has(options.resourceId)) {
    const defaultUrl = await getDefaultNodeUrl(ctx, {
      filterNode: options.filterDefaultNode
        ? (node) => options.filterDefaultNode!(node, resourceIds)
        : undefined,
    });
    if (defaultUrl) {
      return redirect(defaultUrl);
    }
    return { notFound: true };
  }

  return null;
};
