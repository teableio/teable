import { dehydrate } from '@tanstack/react-query';
import { BaseNodeResourceType, LastVisitResourceType } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import dynamic from 'next/dynamic';
import type { IBaseResourceParsed } from '@/features/app/hooks/useBaseResource';
import { redirect } from './helper';
import type { ISSRContext, SSRResult } from './types';

export const getDashboardServerSideProps = async (
  ctx: ISSRContext,
  parsed: IBaseResourceParsed
): Promise<SSRResult> => {
  const { ssrApi, baseId, queryClient, base } = ctx;
  if (parsed.resourceType !== BaseNodeResourceType.Dashboard) return { notFound: true };

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

    return {
      props: {
        ...(await ctx.getTranslationsProps()),
        dehydratedState: dehydrate(ctx.queryClient),
        base,
      },
    };
  }

  const dashboardList = await queryClient.fetchQuery({
    queryKey: ReactQueryKeys.getDashboardList(baseId),
    queryFn: () => ssrApi.getDashboardList(baseId),
  });

  const dashboardIds = dashboardList.map((d) => d.id);

  // If dashboard doesn't exist, redirect to default node
  if (!dashboardIds.includes(dashboardId)) {
    const { getDefaultNodeUrl } = await import('./helper');
    const defaultUrl = await getDefaultNodeUrl(ctx);
    if (defaultUrl) {
      return redirect(defaultUrl);
    }
    return { notFound: true };
  }

  await queryClient.fetchQuery({
    queryKey: ReactQueryKeys.getDashboard(dashboardId),
    queryFn: () => ssrApi.getDashboard(baseId, dashboardId),
  });

  return {
    props: {
      ...(await ctx.getTranslationsProps()),
      dehydratedState: dehydrate(ctx.queryClient),
      base,
    },
  };
};

const DynamicDashboard = dynamic(
  () => import('@/features/app/dashboard/Pages').then((mod) => mod.DashboardPage),
  {
    ssr: false,
  }
);

export const DashBoardPage = () => {
  return <DynamicDashboard />;
};
