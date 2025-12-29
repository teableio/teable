import type { QueryClient } from '@tanstack/react-query';
import { getNodeUrl } from '@/features/app/blocks/base/base-node/hooks';
import type { SSRResult, ISSRContext } from './types';

export const redirect = (destination: string): SSRResult => ({
  redirect: { destination, permanent: false },
});

/**
 * Get the default node URL when a specific node is not found
 * This function will redirect to the first available node in the base
 */
export const getDefaultNodeUrl = async (ctx: ISSRContext): Promise<string | null> => {
  const { ssrApi, baseId } = ctx;

  try {
    const [lastVisitNode, nodes] = await Promise.all([
      ssrApi.getUserLastVisitBaseNode({ parentResourceId: baseId }),
      ssrApi.getBaseNodeList(baseId),
    ]);

    const findNode = nodes.find((n) => n.resourceId === lastVisitNode?.resourceId) ?? nodes[0];
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
  }
): Promise<SSRResult | null> => {
  const { queryClient } = ctx;

  const list = await queryClient.fetchQuery({
    queryKey: options.queryKey,
    queryFn: () => options.fetchList(queryClient),
  });

  const ids = options.extractIds(list);

  // If resource doesn't exist, redirect to default node
  if (!ids.includes(options.resourceId)) {
    const defaultUrl = await getDefaultNodeUrl(ctx);
    if (defaultUrl) {
      return redirect(defaultUrl);
    }
    return { notFound: true };
  }

  return null;
};
