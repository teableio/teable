import { useQuery } from '@tanstack/react-query';
import type { IFieldVo, IViewVo } from '@teable/core';
import { FieldKeyType, ViewType } from '@teable/core';
import type { IRecordsVo } from '@teable/openapi';
import { getFields, getRecords, getViewList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk';
import {
  buildSubscribeProjection,
  frozenFieldIdsFromView,
} from '@teable/sdk/utils/column-projection';
import { INITIAL_LOAD_PAGE_SIZE } from '@teable/sdk/utils/record-window';
import { sortBy } from 'lodash';

type IColumnMetaLike = Record<string, { order?: number; hidden?: boolean } | undefined>;

/**
 * Visible field ids of the target view, in the view's column order.
 *
 * Only the record subscription projection is view-scoped. The field list
 * itself is not: `getFields({ viewId })` answers with the view's visible
 * columns only, and a provider seeded from that truncated list loses the
 * hidden fields — the grid's hidden-field count and every hidden-field
 * dependency read as if those fields did not exist until the live field
 * subscription lands.
 */
export const resolveSeedVisibleFieldIds = (
  fields: IFieldVo[] | undefined,
  view: IViewVo | undefined
): string[] => {
  if (!fields?.length) return [];
  if (!view) return fields.map(({ id }) => id);

  const columnMeta = (view.columnMeta ?? {}) as IColumnMetaLike;
  return sortBy(
    fields.filter(({ id }) => columnMeta[id]?.hidden !== true),
    ({ id }) => columnMeta[id]?.order ?? Infinity
  ).map(({ id }) => id);
};

/** Fetch the same data set the SSR path assembles for a (table, view) anchor. */
export const fetchTableSeed = async (
  tableId: string,
  viewId: string,
  collapsedGroupIds?: readonly string[]
) => {
  const [fields, views] = await Promise.all([
    // deliberately unscoped by view: a view-scoped list hides the view's
    // hidden fields from the providers
    getFields(tableId).then((res) => res.data),
    getViewList(tableId).then((res) => res.data),
  ]);

  const targetView = views.find((view) => view.id === viewId);
  const orderedVisibleFieldIds = resolveSeedVisibleFieldIds(fields, targetView);
  const viewOptions = targetView?.options as
    | { frozenFieldId?: string; frozenColumnCount?: number }
    | undefined;
  const isGridView = targetView?.type === ViewType.Grid;
  const projection = isGridView
    ? buildSubscribeProjection({
        orderedVisibleFieldIds,
        frozenFieldIds: frozenFieldIdsFromView({
          orderedVisibleFieldIds,
          frozenFieldId: viewOptions?.frozenFieldId,
          frozenColumnCount: viewOptions?.frozenColumnCount,
        }),
        primaryFieldId: fields?.find((field) => field.isPrimary)?.id,
      })
    : undefined;
  const collapsedIds = collapsedGroupIds?.length ? [...collapsedGroupIds] : undefined;
  const recordsQuery = {
    viewId,
    fieldKeyType: FieldKeyType.Id,
    take: INITIAL_LOAD_PAGE_SIZE,
    ...(projection?.length ? { projection } : {}),
    // the grid's first frame must match its local collapse state, or the seed
    // re-opens groups the user had collapsed before switching away
    ...(collapsedIds ? { collapsedGroupIds: collapsedIds } : {}),
  };

  // mirror the SSR behavior: a records failure (e.g. corrupted view filter)
  // must not block fields/views from seeding
  let records = await getRecords(tableId, recordsQuery).then(
    (res) => res.data,
    () => undefined as IRecordsVo | undefined
  );

  const group = targetView?.type === ViewType.Grid ? targetView.group : undefined;
  if (group?.length) {
    records = await getRecords(tableId, { ...recordsQuery, groupBy: group }).then(
      (res) => res.data,
      () => undefined as IRecordsVo | undefined
    );
  }

  return {
    fields,
    views,
    records,
    groupPoints: records?.extra?.groupPoints ?? null,
  };
};

/**
 * Bootstrap data for a client-side table switch.
 *
 * A table switch is a shallow route change, so getServerSideProps does not
 * re-run and the SSR props still describe the previously loaded table. This
 * hook fetches the same data set the SSR path assembles (fields + views +
 * first records page), but with all requests issued concurrently. The result
 * seeds the sharedb-backed providers so the grid can paint after a single
 * round trip; the subscriptions take over as source of truth once ready.
 */
export const useTableSeed = (
  tableId: string,
  viewId: string,
  enabled: boolean,
  collapsedGroupIds?: readonly string[]
) => {
  return useQuery({
    queryKey: ReactQueryKeys.tableSeed(tableId, viewId, collapsedGroupIds),
    enabled,
    // the seed is one-shot bootstrap data: subscriptions own freshness once
    // live, so background refetches would only be discarded (the reducer
    // rejects seeds over doc-backed instances). The short gcTime bounds how
    // stale a cached seed can be when switching back to a recent table.
    staleTime: Infinity,
    gcTime: 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: () => fetchTableSeed(tableId, viewId, collapsedGroupIds),
  });
};
