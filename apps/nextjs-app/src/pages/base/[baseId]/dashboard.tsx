import type { IGetBaseVo, ITableVo } from '@teable/openapi';
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
      const { baseId } = context.query;
      const result = await ssrApi.getTables(baseId as string);
      const base = await ssrApi.getBaseById(baseId as string);
      return {
        props: {
          tableServerData: result,
          baseServerData: base,
          ...(await getTranslationsProps(context, dashboardConfig.i18nNamespaces)),
        },
      };
    })
  )
);

Node.getLayout = function getLayout(
  page: ReactElement,
  pageProps: { tableServerData: ITableVo[]; baseServerData: IGetBaseVo }
) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};
export default Node;
