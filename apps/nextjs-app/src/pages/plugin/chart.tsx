import type { IGetBaseVo, ITableVo } from '@teable/openapi';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { ChartLayout } from '@/features/app/blocks/chart/ChartLayout';
import { dashboardConfig } from '@/features/i18n/dashboard.config';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import { ChartPage } from '../../features/app/blocks/chart/ChartPage';

const Node: NextPageWithLayout = () => <ChartPage />;

export const getServerSideProps: GetServerSideProps = withAuthSSR(async (context, ssrApi) => {
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
});

Node.getLayout = function getLayout(
  page: ReactElement,
  pageProps: { tableServerData: ITableVo[]; baseServerData: IGetBaseVo }
) {
  return <ChartLayout {...pageProps}>{page}</ChartLayout>;
};
export default Node;
