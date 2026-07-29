import { useQuery } from '@tanstack/react-query';
import { FieldKeyType, ViewType } from '@teable/core';
import type { IRecordsVo } from '@teable/openapi';
import { getFields, getRecords, getViewList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk';

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
export const useTableSeed = (tableId: string, viewId: string, enabled: boolean) => {
  return useQuery({
    queryKey: ReactQueryKeys.tableSeed(tableId, viewId),
    enabled,
    // the seed is one-shot bootstrap data: subscriptions own freshness once
    // live, so background refetches would only be discarded (the reducer
    // rejects seeds over doc-backed instances). The short gcTime bounds how
    // stale a cached seed can be when switching back to a recent table.
    staleTime: Infinity,
    gcTime: 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const recordsQuery = { viewId, fieldKeyType: FieldKeyType.Id } as const;
      const [fields, views, plainRecords] = await Promise.all([
        getFields(tableId, { viewId }).then((res) => res.data),
        getViewList(tableId).then((res) => res.data),
        // mirror the SSR behavior: a records failure (e.g. corrupted view
        // filter) must not block fields/views from seeding
        getRecords(tableId, recordsQuery).then(
          (res) => res.data,
          () => undefined as IRecordsVo | undefined
        ),
      ]);

      // grouped grid views lay rows out from groupPoints, which only come
      // back when groupBy is sent — refetch with it once the view config is
      // known. Other view types never consume seeded records, so skip them.
      let records = plainRecords;
      const targetView = views.find((view) => view.id === viewId);
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
    },
  });
};
