import { useQuery } from '@tanstack/react-query';
import type { IViewVo } from '@teable/core';
import { BaseNodeResourceType, getUserLastVisitListBaseNode, getViewList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useContext, useMemo } from 'react';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { useTableHref } from '../../table-list/useTableHref';
import { VIEW_ICON_MAP } from '../../view/constant';
import { BaseNodeContext } from '../base-node/BaseNodeContext';
import { BaseNodeResourceIconMap, getNodeIcon, getNodeName, getNodeUrl } from '../base-node/hooks';
import type { PaletteEntry } from './palette-types';

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
  const { treeItems, isLoaded, isLoading } = useContext(BaseNodeContext);
  // The sidebar keeps the palette mounted while closed; the last-visited views wait for it to open.
  const { hrefMap } = useTableHref(open);

  const nodes = useMemo(
    () =>
      Object.values(treeItems).filter((node) => node.resourceType !== BaseNodeResourceType.Folder),
    [treeItems]
  );
  const isTable = nodes.some(
    (node) => node.resourceId === tableId && node.resourceType === BaseNodeResourceType.Table
  );

  // The reader's own visits in this project, newest first, as the server records them. Fetched
  // again on every open, so visits from other tabs and devices show up.
  const { data: visits } = useQuery({
    queryKey: ReactQueryKeys.recentBaseNodes(baseId),
    queryFn: () =>
      getUserLastVisitListBaseNode({ parentResourceId: baseId }).then(({ data }) => data.list),
    enabled: open,
    staleTime: 0,
  });
  const lastVisited = useMemo(
    () =>
      new Map(
        (visits ?? []).map((visit) => [visit.resourceId, new Date(visit.lastVisitTime).getTime()])
      ),
    [visits]
  );

  const viewQuery = useQuery({
    queryKey: ReactQueryKeys.viewList(tableId ?? ''),
    queryFn: () => getViewList(tableId!).then(({ data }) => data),
    enabled: open && isLoaded && isTable,
    // Realtime view creation does not update this cache; reopening must revalidate it.
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });

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
            lastVisited: lastVisited.get(node.resourceId),
            category: node.resourceType,
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
      category: BaseNodeResourceType.Table,
    };
  };
  const views =
    isLoaded && tableId && viewQuery.isSuccess && !viewQuery.isFetching
      ? viewQuery.data.map((view) => viewEntry(tableId, view))
      : [];
  // Visits of nodes the tree no longer lists (deleted, or no longer readable) are left out.
  const recent = (visits ?? []).flatMap((visit) => {
    const entry = resourceById.get(visit.resourceId);
    return entry ? [entry] : [];
  });

  return {
    resources,
    views,
    recent,
    isLoading: isLoading || (open && viewQuery.isFetching),
  };
};
