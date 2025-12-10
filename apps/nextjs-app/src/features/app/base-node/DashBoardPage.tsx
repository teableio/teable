import { dehydrate } from '@tanstack/react-query';
import { BaseNodeResourceType, LastVisitResourceType } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { DashboardPage as DashboardPageComponent } from '@/features/app/dashboard/Pages';
import type { IBaseResourceParsed } from '@/features/app/hooks/useBaseResource';
import { redirect } from './helper';
import type { ISSRContext, SSRResult } from './types';

export const getDashboardServerSideProps = async (
  ctx: ISSRContext,
  parsed: IBaseResourceParsed
): Promise<SSRResult> => {
  const { ssrApi, baseId, queryClient } = ctx;
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
      },
    };
  }

  await queryClient.fetchQuery({
    queryKey: ReactQueryKeys.getDashboard(dashboardId),
    queryFn: () => ssrApi.getDashboard(baseId, dashboardId),
  });

  return {
    props: {
      ...(await ctx.getTranslationsProps()),
      dehydratedState: dehydrate(ctx.queryClient),
    },
  };
};

export const DashBoardPage = () => {
  return <DashboardPageComponent />;
};
