import { dehydrate, QueryClient } from '@tanstack/react-query';
import { type IGetBaseVo, type ITableVo } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { DashboardPage } from '@/features/app/dashboard/Pages';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { dashboardConfig } from '@/features/i18n/dashboard.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import withEnv from '@/lib/withEnv';

const Node: NextPageWithLayout = () => <DashboardPage />;

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
      const { baseId, dashboardId: dashboardIdQuery } = context.query;
      const result = await ssrApi.getTables(baseId as string);
      const base = await ssrApi.getBaseById(baseId as string);
      const queryClient = new QueryClient();

      const dashboardList = await queryClient.fetchQuery({
        queryKey: ReactQueryKeys.getDashboardList(baseId as string),
        queryFn: ({ queryKey }) => ssrApi.getDashboardList(queryKey[1]),
      });

      const dashboardId = dashboardIdQuery ? (dashboardIdQuery as string) : dashboardList[0]?.id;

      if (dashboardId) {
        await queryClient.fetchQuery({
          queryKey: ReactQueryKeys.getDashboard(dashboardId),
          queryFn: ({ queryKey }) => ssrApi.getDashboard(baseId as string, queryKey[1]),
        });
      }

      return {
        props: {
          tableServerData: result,
          baseServerData: base,
          dehydratedState: dehydrate(queryClient),
          ...(await getTranslationsProps(context, dashboardConfig.i18nNamespaces)),
        },
      };
    })
  )
);

Node.getLayout = function getLayout(
  page: ReactElement,
  pageProps: {
    tableServerData: ITableVo[];
    baseServerData: IGetBaseVo;
  }
) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};
export default Node;
