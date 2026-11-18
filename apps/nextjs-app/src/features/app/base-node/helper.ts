import type { QueryClient } from '@tanstack/react-query';
import { HttpError, HttpErrorCode, ViewType } from '@teable/core';
import type { IBaseNodeVo } from '@teable/openapi';
import { BaseNodeResourceType, LastVisitResourceType } from '@teable/openapi';
import type { SsrApi } from '@/backend/api/rest/ssr-api';
import { getNodeUrl } from '@/features/app/blocks/base/base-node/hooks/helper';
import type { SSRResult, ISSRContext } from './types';

export const redirect = (destination: string): SSRResult => ({
  redirect: { destination, permanent: false },
});

/**
 * Resolve the default view of a table: prefer the last visited view,
 * otherwise fall back to the first view (skipping form views when opening a record)
 */
export const getDefaultViewId = async (
  ssrApi: SsrApi,
  tableId: string,
  queryParams?: { recordId?: string }
) => {
  const { recordId } = queryParams ?? {};
  const [lastVisit, viewList] = await Promise.all([
    ssrApi.getUserLastVisit(LastVisitResourceType.View, tableId),
    ssrApi.getViewList(tableId),
  ]);
  if (viewList.length === 0) {
    return undefined;
  }
  const nonFormViews = viewList.filter((v) => v.type !== ViewType.Form);
  const candidateViews = recordId && nonFormViews.length > 0 ? nonFormViews : viewList;
  const viewIds = candidateViews.map((v) => v.id);

  return lastVisit?.resourceId && viewIds.includes(lastVisit.resourceId)
    ? lastVisit.resourceId
    : viewIds[0]!;
};

/** Default navigation may skip an inaccessible table, but must not hide request failures. */
export const getDefaultViewIdForNavigation = async (ssrApi: SsrApi, tableId: string) => {
  try {
    return await getDefaultViewId(ssrApi, tableId);
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 403 || error.status === 404) return undefined;
      if (
        error.status === 400 &&
        error.code === HttpErrorCode.VALIDATION_ERROR &&
        typeof error.data === 'object' &&
        error.data !== null &&
        'domainCode' in error.data &&
        error.data.domainCode === 'validation.invalid'
      ) {
        return undefined;
      }
    }
    throw error;
  }
};

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

  const [lastVisitNode, nodes] = await Promise.all([
    ssrApi.getUserLastVisitBaseNode({ parentResourceId: baseId }),
    ssrApi.getBaseNodeList(baseId),
  ]);
  const availableNodes = nodes.filter(
    (node) =>
      node.resourceType !== BaseNodeResourceType.Folder &&
      (!options?.filterNode || options.filterNode(node))
  );
  const lastNode = availableNodes.find((node) => node.resourceId === lastVisitNode?.resourceId);
  const candidates = lastNode
    ? [lastNode, ...availableNodes.filter((node) => node !== lastNode)]
    : availableNodes;

  for (const node of candidates) {
    let viewId: string | undefined;
    if (node.resourceType === BaseNodeResourceType.Table) {
      viewId = await getDefaultViewIdForNavigation(ssrApi, node.resourceId);
      if (!viewId) continue;
    }
    const url = getNodeUrl({
      baseId,
      resourceType: node.resourceType,
      resourceId: node.resourceId,
      viewId,
    });
    if (url?.pathname) return url.pathname;
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
