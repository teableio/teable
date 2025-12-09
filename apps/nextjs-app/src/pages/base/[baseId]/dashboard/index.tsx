import { dehydrate, QueryClient } from '@tanstack/react-query';
import { LastVisitResourceType } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { DashboardPage } from '@/features/app/dashboard/Pages';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { dashboardConfig } from '@/features/i18n/dashboard.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { IBasePageProps, NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const Node: NextPageWithLayout = () => <DashboardPage />;

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
      const { baseId } = context.query;
      const queryClient = new QueryClient();

      const [lastVisit, dashboardList] = await Promise.all([
        ssrApi.getUserLastVisit(LastVisitResourceType.Dashboard, baseId as string),

        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.getDashboardList(baseId as string),
          queryFn: ({ queryKey }) => ssrApi.getDashboardList(queryKey[1]),
        }),
      ]);

      const dashboardIds = dashboardList.map((dashboard) => dashboard.id);
      const dashboardId =
        lastVisit?.resourceId && dashboardIds.includes(lastVisit.resourceId)
          ? lastVisit.resourceId
          : dashboardIds[0];
      if (dashboardId) {
        return {
          redirect: {
            destination: `/base/${baseId}/dashboard/${dashboardId}`,
            permanent: false,
          },
        };
      }

      await Promise.all([
        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.base(baseId as string),
          queryFn: ({ queryKey }) =>
            queryKey[1] ? ssrApi.getBaseById(baseId as string) : undefined,
        }),

        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.getBasePermission(baseId as string),
          queryFn: ({ queryKey }) => ssrApi.getBasePermission(queryKey[1]),
        }),
      ]);

      return {
        props: {
          dehydratedState: dehydrate(queryClient),
          ...(await getTranslationsProps(context, dashboardConfig.i18nNamespaces)),
        },
      };
    })
  )
);

Node.getLayout = function getLayout(page: ReactElement, pageProps: IBasePageProps) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};
export default Node;
