/* eslint-disable sonarjs/cognitive-complexity */
import { dehydrate } from '@tanstack/react-query';
import { ViewType } from '@teable/core';
import { BaseNodeResourceType, LastVisitResourceType } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import dynamic from 'next/dynamic';
import type { SsrApi } from '@/backend/api/rest/ssr-api';
import type { IBaseResourceParsed } from '@/features/app/hooks/useBaseResource';
import { getViewPageServerData } from '@/lib/view-pages-data';
import { redirect, validateResourceExists } from './helper';
import type { ISSRContext, SSRResult, ITablePageProps } from './types';

interface IQueryParams {
  recordId?: string;
  fromNotify?: string;
  [key: string]: unknown;
}

const getDefaultViewId = async (ssrApi: SsrApi, tableId: string, queryParams?: IQueryParams) => {
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

export const getTableServerSideProps = async (
  ctx: ISSRContext,
  parsed: IBaseResourceParsed,
  queryParams?: IQueryParams
): Promise<SSRResult> => {
  const { ssrApi, baseId, queryClient, base } = ctx;
  if (parsed.resourceType !== BaseNodeResourceType.Table) return { notFound: true };
  const { tableId, viewId } = parsed;
  const { recordId, fromNotify: notifyId } = queryParams ?? {};
  const queryString = queryParams
    ? new URLSearchParams(queryParams as Record<string, string>).toString()
    : '';
  const query = queryString ? `?${queryString}` : '';

  if (!tableId) {
    const [lastVisit, tableList] = await Promise.all([
      ssrApi.getUserLastVisit(LastVisitResourceType.Table, baseId),
      ssrApi.getTables(baseId),
    ]);
    const tableIds = tableList.map((t) => t.id);
    const defaultTableId =
      lastVisit?.resourceId && tableIds.includes(lastVisit.resourceId)
        ? lastVisit.resourceId
        : tableIds[0];

    const defaultViewId = defaultTableId
      ? await getDefaultViewId(ssrApi, defaultTableId)
      : undefined;
    if (defaultTableId && defaultViewId) {
      return redirect(`/base/${baseId}/table/${defaultTableId}/${defaultViewId}`);
    }
    return redirect(`/base/${baseId}`);
  }

  // check table exists first
  const tableList = await queryClient.fetchQuery({
    queryKey: ReactQueryKeys.tableList(baseId),
    queryFn: () => ssrApi.getTables(baseId),
  });

  if (tableList.length === 0) return { notFound: true };

  // If table doesn't exist, redirect to default node
  const validationResult = await validateResourceExists(ctx, {
    resourceId: tableId,
    queryKey: ReactQueryKeys.tableList(baseId),
    fetchList: () => ssrApi.getTables(baseId),
    extractIds: (list) => list.map((t) => t.id),
  });

  if (validationResult) {
    return validationResult;
  }

  // Table exists, now handle viewId
  if (!viewId) {
    const defaultViewId = await getDefaultViewId(ssrApi, tableId, queryParams);
    if (defaultViewId) {
      return redirect(`/base/${baseId}/table/${tableId}/${defaultViewId}${query}`);
    }
    return { notFound: true };
  }

  const tableIds = tableList.map((t) => t.id);
  if (tableIds.length === 0) {
    return redirect(`/base/${baseId}`);
  }
  if (!tableIds.includes(tableId)) {
    return redirect(`/base/${baseId}/table/${tableIds[0]}`);
  }

  // check view exists
  const viewList = await queryClient.fetchQuery({
    queryKey: ReactQueryKeys.viewList(tableId),
    queryFn: () => ssrApi.getViewList(tableId),
  });
  const viewIds = viewList.map((v) => v.id);
  if (viewIds.length === 0) return { notFound: true };
  if (!viewIds.includes(viewId)) {
    return redirect(`/base/${baseId}/table/${tableId}/${viewIds[0]}${query}`);
  }

  // handle recordId
  let recordServerData: ITablePageProps['recordServerData'];
  if (recordId) {
    if (notifyId) await ssrApi.updateNotificationStatus(notifyId, { isRead: true });
    recordServerData = await ssrApi.getRecord(tableId, recordId);
    if (!recordServerData) return redirect(`/base/${baseId}/table/${tableId}/${viewId}`);
  }

  const serverData = await getViewPageServerData(ssrApi, baseId, tableId, viewId);
  if (!serverData) return { notFound: true };

  await queryClient.fetchQuery({
    queryKey: ReactQueryKeys.getTablePermission(baseId, tableId),
    queryFn: () => ssrApi.getTablePermission(baseId, tableId),
  });
  return {
    props: {
      ...serverData,
      ...(recordServerData ? { recordServerData } : {}),
      ...(await ctx.getTranslationsProps()),
      dehydratedState: dehydrate(ctx.queryClient),
      base,
    },
  };
};

const DynamicTable = dynamic(
  () => import('@/features/app/blocks/table/Table').then((mod) => mod.Table),
  {
    ssr: false,
  }
);

export const TablePage = ({
  fieldServerData,
  viewServerData,
  recordsServerData,
  recordServerData,
  groupPointsServerDataMap,
}: ITablePageProps) => {
  return (
    <DynamicTable
      fieldServerData={fieldServerData ?? []}
      viewServerData={viewServerData ?? []}
      recordsServerData={recordsServerData ?? { records: [] }}
      recordServerData={recordServerData}
      groupPointsServerDataMap={groupPointsServerDataMap}
    />
  );
};
