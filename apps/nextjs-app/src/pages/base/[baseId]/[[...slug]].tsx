import { dehydrate, QueryClient } from '@tanstack/react-query';
import { IdPrefix, type IFieldVo, type IRecord, type IViewVo } from '@teable/core';
import type { IGroupPointsVo } from '@teable/openapi';
import { BaseNodeResourceType, LastVisitResourceType } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { GetServerSideProps, GetServerSidePropsContext, GetServerSidePropsResult } from 'next';
import type { ReactElement } from 'react';
import type { SsrApi } from '@/backend/api/rest/ssr-api';
import { AutomationPage } from '@/features/app/automation/Pages';
import { CommunityPage } from '@/features/app/base/CommunityPage';
import { getNodeUrl } from '@/features/app/blocks/base/base-node/hooks';
import { Table } from '@/features/app/blocks/table/Table';
import { DashboardPage } from '@/features/app/dashboard/Pages';
import type { IBaseResourceParsed } from '@/features/app/hooks/useBaseResource';
import { parseBaseSlug, useBaseResource } from '@/features/app/hooks/useBaseResource';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { baseAllConfig } from '@/features/i18n/base-all.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import { getViewPageServerData } from '@/lib/view-pages-data';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

// ============================================================================
// Types (exported for reuse in enterprise version)
// ============================================================================

interface IPageProps {
  fieldServerData?: IFieldVo[];
  viewServerData?: IViewVo[];
  recordsServerData?: { records: IRecord[] };
  recordServerData?: IRecord;
  groupPointsServerDataMap?: { [viewId: string]: IGroupPointsVo | undefined };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface ISSRContext {
  context: GetServerSidePropsContext;
  queryClient: QueryClient;
  baseId: string;
  ssrApi: SsrApi;
}

export type SSRResult = GetServerSidePropsResult<IPageProps>;

export type BuildBaseProps = (
  ctx: ISSRContext,
  extra?: Record<string, unknown>
) => Promise<Record<string, unknown>>;

// ============================================================================
// Helper Functions (exported for reuse)
// ============================================================================

export const redirect = (destination: string): SSRResult => ({
  redirect: { destination, permanent: false },
});

export const getDefaultViewId = async (ssrApi: SsrApi, tableId: string) => {
  const [lastVisit, viewList] = await Promise.all([
    ssrApi.getUserLastVisit(LastVisitResourceType.View, tableId),
    ssrApi.getViewList(tableId),
  ]);
  const viewIds = viewList.map((v) => v.id);
  return lastVisit?.resourceId && viewIds.includes(lastVisit.resourceId)
    ? lastVisit.resourceId
    : viewIds[0];
};

// ============================================================================
// SSR Handlers (exported for reuse)
// ============================================================================

export const handleEmptyPath = async (
  ctx: ISSRContext,
  buildBaseProps: BuildBaseProps
): Promise<SSRResult> => {
  const { ssrApi, baseId } = ctx;
  const [lastVisitNode, nodes] = await Promise.all([
    ssrApi.getUserLastVisitBaseNode({ parentResourceId: baseId }),
    ssrApi.getBaseNodeList(baseId),
  ]);

  const findNode = nodes.find((n) => n.resourceId === lastVisitNode?.resourceId);
  if (findNode) {
    const url = getNodeUrl({
      baseId,
      resourceType: findNode.resourceType,
      resourceId: findNode.resourceId,
    });
    if (url?.pathname) return redirect(url.pathname);
  }

  return { props: await buildBaseProps(ctx) };
};

export const handleTableResource = async (
  ctx: ISSRContext,
  parsed: IBaseResourceParsed,
  buildBaseProps: BuildBaseProps,
  queryParams: Record<string, string | string[] | undefined>
  // eslint-disable-next-line sonarjs/cognitive-complexity
): Promise<SSRResult> => {
  const { ssrApi, baseId, queryClient } = ctx;
  if (parsed.resourceType !== 'table') return { notFound: true };
  const { tableId, viewId } = parsed;
  const { recordId, fromNotify: notifyId } = queryParams as {
    recordId?: string;
    fromNotify?: string;
  };
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
    return { notFound: true };
  }

  if (!viewId) {
    const defaultViewId = await getDefaultViewId(ssrApi, tableId);
    if (defaultViewId) {
      return redirect(`/base/${baseId}/table/${tableId}/${defaultViewId}`);
    }
    return { notFound: true };
  }

  // check table exists
  const [tableList] = await Promise.all([
    queryClient.fetchQuery({
      queryKey: ReactQueryKeys.tableList(baseId),
      queryFn: () => ssrApi.getTables(baseId),
    }),
    queryClient.fetchQuery({
      queryKey: ReactQueryKeys.getTablePermission(baseId, tableId),
      queryFn: () => ssrApi.getTablePermission(baseId, tableId),
    }),
  ]);

  const tableIds = tableList.map((t) => t.id);
  if (tableIds.length === 0) return { notFound: true };
  if (!tableIds.includes(tableId)) return redirect(`/base/${baseId}/table/${tableIds[0]}`);

  // check view exists
  const viewList = await queryClient.fetchQuery({
    queryKey: ReactQueryKeys.viewList(tableId),
    queryFn: () => ssrApi.getViewList(tableId),
  });
  const viewIds = viewList.map((v) => v.id);
  if (viewIds.length === 0) return { notFound: true };
  if (!viewIds.includes(viewId)) return redirect(`/base/${baseId}/table/${tableId}/${viewIds[0]}`);

  // handle recordId
  let recordServerData: IRecord | undefined;
  if (recordId) {
    if (notifyId) await ssrApi.updateNotificationStatus(notifyId, { isRead: true });
    recordServerData = await ssrApi.getRecord(tableId, recordId);
    if (!recordServerData) return redirect(`/base/${baseId}/table/${tableId}/${viewId}`);
  }

  const serverData = await getViewPageServerData(ssrApi, baseId, tableId, viewId);
  if (!serverData) return { notFound: true };

  return {
    props: {
      ...serverData,
      ...(recordServerData ? { recordServerData } : {}),
      ...(await buildBaseProps(ctx)),
    },
  };
};

export const handleDashboardResource = async (
  ctx: ISSRContext,
  parsed: IBaseResourceParsed,
  buildBaseProps: BuildBaseProps
): Promise<SSRResult> => {
  const { ssrApi, baseId, queryClient } = ctx;
  if (parsed.resourceType !== 'dashboard') return { notFound: true };

  const { dashboardId } = parsed;

  if (!dashboardId) {
    const [lastVisit, dashboardList] = await Promise.all([
      ssrApi.getUserLastVisit(LastVisitResourceType.Dashboard, baseId),
      queryClient.fetchQuery({
        queryKey: ReactQueryKeys.getDashboardList(baseId),
        queryFn: () => ssrApi.getDashboardList(baseId),
      }),
    ]);

    const ids = dashboardList.map((d) => d.id);
    const defaultId =
      lastVisit?.resourceId && ids.includes(lastVisit.resourceId) ? lastVisit.resourceId : ids[0];
    if (defaultId) return redirect(`/base/${baseId}/dashboard/${defaultId}`);

    return { props: await buildBaseProps(ctx) };
  }

  await queryClient.fetchQuery({
    queryKey: ReactQueryKeys.getDashboard(dashboardId),
    queryFn: () => ssrApi.getDashboard(baseId, dashboardId),
  });

  return { props: await buildBaseProps(ctx) };
};

// ============================================================================
// Local buildBaseProps (uses local i18n config)
// ============================================================================

const buildBaseProps: BuildBaseProps = async (ctx, extra) => ({
  ...extra,
  ...(await getTranslationsProps(ctx.context, baseAllConfig.i18nNamespaces)),
  dehydratedState: dehydrate(ctx.queryClient),
});

// ============================================================================
// Page Component
// ============================================================================

const UnifiedBasePage: NextPageWithLayout<IPageProps> = ({
  fieldServerData,
  viewServerData,
  recordsServerData,
  recordServerData,
  groupPointsServerDataMap,
}) => {
  const { resourceType } = useBaseResource();

  switch (resourceType) {
    case BaseNodeResourceType.Table:
      if (fieldServerData && viewServerData && recordsServerData) {
        return (
          <Table
            fieldServerData={fieldServerData}
            viewServerData={viewServerData}
            recordsServerData={recordsServerData}
            recordServerData={recordServerData}
            groupPointsServerDataMap={groupPointsServerDataMap}
          />
        );
      }
      return null;
    case BaseNodeResourceType.Dashboard:
      return <DashboardPage />;
    case BaseNodeResourceType.Workflow:
      return <AutomationPage />;
    case BaseNodeResourceType.App:
      return <div>App Page</div>;
    default:
      return <CommunityPage />;
  }
};

// ============================================================================
// getServerSideProps
// ============================================================================

export const getServerSideProps: GetServerSideProps<IPageProps> = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
      const { baseId, slug, ...queryParams } = context.query;
      const queryClient = new QueryClient();
      // Redirect legacy table URLs: /base/xxx/tbl1/viw1 → /base/xxx/table/tbl1/viw1
      if (Array.isArray(slug) && slug.length > 0 && slug[0].startsWith(IdPrefix.Table)) {
        const queryString = new URLSearchParams(queryParams as Record<string, string>).toString();
        const tablePath = slug[1] ? `${slug[0]}/${slug[1]}` : slug[0];
        return redirect(`/base/${baseId}/table/${tablePath}?${queryString}`);
      }
      const parsed = parseBaseSlug(slug as string[]);
      const baseIdStr = baseId as string;

      await Promise.all([
        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.base(baseIdStr),
          queryFn: () => ssrApi.getBaseById(baseIdStr),
        }),
        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.getBasePermission(baseIdStr),
          queryFn: () => ssrApi.getBasePermission(baseIdStr),
        }),
      ]);

      const ctx: ISSRContext = { context, queryClient, baseId: baseIdStr, ssrApi };

      if (!parsed.resourceType) {
        return handleEmptyPath(ctx, buildBaseProps);
      }

      switch (parsed.resourceType) {
        case BaseNodeResourceType.Table:
          return handleTableResource(ctx, parsed, buildBaseProps, queryParams);
        case BaseNodeResourceType.Dashboard:
          return handleDashboardResource(ctx, parsed, buildBaseProps);
        case BaseNodeResourceType.Workflow:
        case BaseNodeResourceType.App:
          return { props: await buildBaseProps(ctx) };
        default:
          return { notFound: true };
      }
    })
  )
);

UnifiedBasePage.getLayout = function getLayout(page: ReactElement, pageProps: IPageProps) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};

export default UnifiedBasePage;
