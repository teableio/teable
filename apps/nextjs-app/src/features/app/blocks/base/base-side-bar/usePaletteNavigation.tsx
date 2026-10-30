import { useQueries } from '@tanstack/react-query';
import type { IViewVo } from '@teable/core';
import { HttpError } from '@teable/core';
import { BaseNodeResourceType, getViewList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useSession } from '@teable/sdk/hooks';
import { useRouter } from 'next/router';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { useTableHref } from '../../table-list/useTableHref';
import { VIEW_ICON_MAP } from '../../view/constant';
import { BaseNodeContext } from '../base-node/BaseNodeContext';
import type { TreeItemData } from '../base-node/hooks';
import { BaseNodeResourceIconMap, getNodeIcon, getNodeName, getNodeUrl } from '../base-node/hooks';
import {
  addPaletteRecent,
  paletteRecentKey,
  readPaletteRecent,
  writePaletteRecent,
  type PaletteRecentVisit,
} from './palette-recent';
import type { PaletteEntry } from './palette-types';

const MAX_VIEW_TABLES = 6;
const EMPTY_VISITS: PaletteRecentVisit[] = [];

const resolvePaletteRoute = (
  nodes: TreeItemData[],
  baseId: string,
  pathname: string
): Pick<PaletteRecentVisit, 'resourceId' | 'viewId'> | undefined => {
  for (const node of nodes) {
    const resourcePath = getNodeUrl({ baseId, ...node })?.pathname;
    if (!resourcePath) continue;
    if (pathname === resourcePath) return { resourceId: node.resourceId };
    if (
      node.resourceType !== BaseNodeResourceType.Table ||
      !pathname.startsWith(`${resourcePath}/`)
    )
      continue;
    const viewId = pathname.slice(resourcePath.length + 1);
    if (/^viw[\w-]+$/.test(viewId)) return { resourceId: node.resourceId, viewId };
  }
  return undefined;
};

export const usePaletteNavigation = ({
  baseId,
  tableId,
  open,
}: {
  baseId: string;
  tableId?: string;
  open: boolean;
}): {
  resources: PaletteEntry[];
  views: PaletteEntry[];
  recent: PaletteEntry[];
  isLoading: boolean;
} => {
  const { user } = useSession();
  const userId = user?.id ?? '';
  const scope = paletteRecentKey(userId, baseId);
  const { asPath } = useRouter();
  const { treeItems, isLoaded, isLoading } = useContext(BaseNodeContext);
  // The sidebar keeps the palette mounted while closed; the last-visited views wait for it to open.
  const { hrefMap } = useTableHref(open);
  const [history, setHistory] = useState<{ scope: string; visits: PaletteRecentVisit[] }>({
    scope,
    visits: EMPTY_VISITS,
  });
  const visits = history.scope === scope ? history.visits : EMPTY_VISITS;
  const lastRoute = useRef<string | undefined>(undefined);

  const nodes = useMemo(
    () =>
      Object.values(treeItems).filter((node) => node.resourceType !== BaseNodeResourceType.Folder),
    [treeItems]
  );
  const nodesByResource = useMemo(
    () => new Map(nodes.map((node) => [node.resourceId, node])),
    [nodes]
  );

  useEffect(() => {
    setHistory({ scope, visits: readPaletteRecent(userId, baseId) });
  }, [baseId, userId, scope, open]);

  // The sidebar stays mounted while the palette is closed. Observe the actual route so sidebar,
  // view tabs, back/forward, and direct links all count, not just selections made in this dialog.
  useEffect(() => {
    if (!isLoaded || !userId) return;
    const pathname = asPath.split(/[?#]/)[0];
    const routeKey = `${scope}:${pathname}`;
    if (lastRoute.current === routeKey) return;
    lastRoute.current = routeKey;
    const destination = resolvePaletteRoute(nodes, baseId, pathname);
    if (!destination) return;
    const next = addPaletteRecent(readPaletteRecent(userId, baseId), destination);
    writePaletteRecent(userId, baseId, next);
    setHistory({ scope, visits: next });
  }, [asPath, baseId, isLoaded, nodes, scope, userId]);

  const viewTableIds = useMemo(() => {
    const ids = new Set<string>();
    if (tableId && nodesByResource.get(tableId)?.resourceType === BaseNodeResourceType.Table) {
      ids.add(tableId);
    }
    for (const visit of visits) {
      if (ids.size >= MAX_VIEW_TABLES) break;
      if (
        visit.viewId &&
        nodesByResource.get(visit.resourceId)?.resourceType === BaseNodeResourceType.Table
      ) {
        ids.add(visit.resourceId);
      }
    }
    return [...ids];
  }, [nodesByResource, tableId, visits]);
  const viewQueries = useQueries({
    queries: viewTableIds.map((id) => ({
      queryKey: ReactQueryKeys.viewList(id),
      queryFn: () => getViewList(id).then(({ data }) => data),
      enabled: open && isLoaded,
      // Realtime view creation does not update this cache. Reopening must revalidate even
      // inside the app's default freshness window before an absent view can erase history.
      staleTime: 0,
      refetchOnMount: 'always' as const,
      retry: false,
    })),
  });
  const queryByTable = new Map(viewTableIds.map((id, index) => [id, viewQueries[index]]));

  // A missing resource is authoritative only after the tree has resolved. Failed transient
  // requests must not erase history; missing/forbidden views must never survive as stale results.
  const retainedVisits = visits.filter((visit) => {
    if (!isLoaded) return true;
    const node = nodesByResource.get(visit.resourceId);
    if (!node) return false;
    if (!visit.viewId) return true;
    if (node.resourceType !== BaseNodeResourceType.Table) return false;
    const query = queryByTable.get(visit.resourceId);
    if (!query || query.fetchStatus !== 'idle' || !query.isFetchedAfterMount || !open) return true;
    if (query.isSuccess) return query.data.some((view) => view.id === visit.viewId);
    return !(query.error instanceof HttpError && [401, 403, 404].includes(query.error.status));
  });
  useEffect(() => {
    if (retainedVisits.length === visits.length) return;
    writePaletteRecent(userId, baseId, retainedVisits);
    setHistory({ scope, visits: retainedVisits });
  }, [retainedVisits, visits.length, baseId, scope, userId]);

  const statsFor = (resourceId: string, viewId?: string) => {
    const matching = visits.filter(
      (visit) => visit.resourceId === resourceId && (!viewId || visit.viewId === viewId)
    );
    return matching.length
      ? {
          lastVisited: Math.max(...matching.map((visit) => visit.lastVisited)),
          visitCount: matching.reduce((total, visit) => total + visit.visitCount, 0),
        }
      : {};
  };
  const resources: PaletteEntry[] = isLoaded
    ? nodes.flatMap((node) => {
        const href =
          node.resourceType === BaseNodeResourceType.Table
            ? (hrefMap[node.resourceId] ?? getNodeUrl({ baseId, ...node })?.pathname)
            : getNodeUrl({ baseId, ...node })?.pathname;
        if (!href) return [];
        const icon = getNodeIcon(node);
        const Icon = BaseNodeResourceIconMap[node.resourceType];
        return [
          {
            id: node.resourceId,
            label: getNodeName(node),
            href,
            icon: icon ? <Emoji emoji={icon} size="1rem" /> : <Icon className="size-4" />,
            ...statsFor(node.resourceId),
          },
        ];
      })
    : [];
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]));
  const viewEntry = (resourceId: string, view: IViewVo): PaletteEntry => {
    const Icon = VIEW_ICON_MAP[view.type];
    return {
      id: `${resourceId}/${view.id}`,
      label: view.name,
      description: resourceById.get(resourceId)?.label,
      keywords: [resourceById.get(resourceId)?.label ?? ''],
      href:
        getNodeUrl({
          baseId,
          resourceType: BaseNodeResourceType.Table,
          resourceId,
          viewId: view.id,
        })?.pathname ?? undefined,
      icon: <Icon className="size-4" />,
      ...statsFor(resourceId, view.id),
    };
  };
  const currentViews = tableId ? queryByTable.get(tableId) : undefined;
  const views =
    isLoaded && tableId && currentViews?.isSuccess && !currentViews.isFetching
      ? currentViews.data.map((view) => viewEntry(tableId, view))
      : [];
  const seenDestinations = new Set<string>();
  const recent = retainedVisits.flatMap((visit): PaletteEntry[] => {
    if (!isLoaded) return [];
    let entry = resourceById.get(visit.resourceId);
    if (visit.viewId) {
      const query = queryByTable.get(visit.resourceId);
      const view =
        query?.isSuccess && !query.isFetching
          ? query.data.find((view) => view.id === visit.viewId)
          : undefined;
      entry = view ? viewEntry(visit.resourceId, view) : undefined;
    }
    if (!entry?.href || seenDestinations.has(entry.href)) return [];
    seenDestinations.add(entry.href);
    return [{ ...entry, lastVisited: visit.lastVisited, visitCount: visit.visitCount }];
  });

  return {
    resources,
    views,
    recent,
    isLoading: isLoading || (open && viewQueries.some((query) => query.isFetching)),
  };
};
