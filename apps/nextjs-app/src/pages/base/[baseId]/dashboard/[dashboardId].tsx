import { dehydrate, QueryClient } from '@tanstack/react-query';
import { type ITableVo } from '@teable/openapi';
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
import withEnv from '@/lib/withEnv';

const Node: NextPageWithLayout = () => <DashboardPage />;

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
      const { baseId, dashboardId } = context.query;
      const queryClient = new QueryClient();

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

        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.getDashboard(dashboardId as string),
          queryFn: ({ queryKey }) => ssrApi.getDashboard(baseId as string, queryKey[1]),
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

Node.getLayout = function getLayout(
  page: ReactElement,
  pageProps: {
    tableServerData?: ITableVo[];
  }
) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};
export default Node;
