import { BaseNodeResourceType } from '@teable/openapi';
import { useRouter } from 'next/router';
import { useCallback, useState } from 'react';
import { parseBaseSlug } from '../../hooks/useBaseResource';

// one-shot deep-link params that belong to the record they were opened with
const RECORD_SCOPED_QUERY_KEYS = [
  'recordId',
  'fromNotify',
  'commentId',
  'showHistory',
  'showComment',
];

/**
 * The expanded record of a view that opens records itself (kanban, gallery, calendar), kept in
 * the url the way the grid keeps its own: a copied, refreshed or shared link reopens it, and back
 * closes it. A table shown off its route (a tab beside the one the url names) leaves the url to
 * that table and keeps its expanded record in state instead.
 */
export const useRouteExpandRecord = (tableId?: string) => {
  const router = useRouter();
  const routeResource = parseBaseSlug(router.query.slug as string[] | undefined);
  const routeTableId =
    routeResource.resourceType === BaseNodeResourceType.Table ? routeResource.tableId : undefined;
  const ownsRoute = !routeTableId || routeTableId === tableId;
  const [localRecordId, setLocalRecordId] = useState<string>();

  const routerRecordId = router.query.recordId as string | undefined;
  const expandRecordId = ownsRoute ? routerRecordId : localRecordId;
  const showHistory = ownsRoute && router.query.showHistory === 'true';
  const showComment = ownsRoute
    ? { true: true, false: false }[router.query.showComment as string]
    : undefined;

  const setExpandRecordId = useCallback(
    (recordId?: string) => {
      if (!ownsRoute) {
        setLocalRecordId(recordId);
        return;
      }
      if (recordId === routerRecordId) return;
      const query = Object.fromEntries(
        Object.entries(router.query).filter(([key]) => !RECORD_SCOPED_QUERY_KEYS.includes(key))
      );
      router.push(
        { pathname: router.pathname, query: recordId ? { ...query, recordId } : query },
        undefined,
        { shallow: true }
      );
    },
    [ownsRoute, routerRecordId, router]
  );

  const closeExpandRecord = useCallback(() => setExpandRecordId(undefined), [setExpandRecordId]);

  return { expandRecordId, setExpandRecordId, closeExpandRecord, showHistory, showComment };
};

/** The prev / next order for an expanded record: the loaded neighbours it sits among. */
export const getExpandRecordIds = (expandRecordId?: string, orderedRecordIds?: string[]) => {
  if (!expandRecordId) return [];
  return orderedRecordIds?.includes(expandRecordId) ? orderedRecordIds : [expandRecordId];
};
