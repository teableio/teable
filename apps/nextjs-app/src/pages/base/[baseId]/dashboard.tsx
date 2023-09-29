import type { ITableVo } from '@teable-group/core';
import type { IGetBaseVo } from '@teable-group/openapi';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { ssrApi } from '@/backend/api/rest/table.ssr';
import { DashboardPage } from '@/features/app/dashboard/Pages';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import withAuthSSR from '@/lib/withAuthSSR';
import type { NextPageWithLayout } from '../../_app';

const Node: NextPageWithLayout = () => <DashboardPage />;

export const getServerSideProps: GetServerSideProps = withAuthSSR(async (context) => {
  const { baseId } = context.query;
  const result = await ssrApi.getTables(baseId as string);
  const base = await ssrApi.getBaseById(baseId as string);
  return {
    props: {
      tableServerData: result,
      baseServerData: base,
    },
  };
});

Node.getLayout = function getLayout(
  page: ReactElement,
  pageProps: { tableServerData: ITableVo[]; baseServerData: IGetBaseVo }
) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};
export default Node;
