import type { ITableVo } from '@teable-group/core';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { ssrApi } from '@/backend/api/rest/table.ssr';
import { DashboardPage } from '@/features/app/dashboard/Pages';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import withAuthSSR from '@/lib/withAuthSSR';
import type { NextPageWithLayout } from '../_app';

const Node: NextPageWithLayout = () => <DashboardPage />;

export const getServerSideProps: GetServerSideProps = withAuthSSR(async () => {
  const result = await ssrApi.getTables();
  return {
    props: {
      tableServerData: result,
    },
  };
});

Node.getLayout = function getLayout(
  page: ReactElement,
  pageProps: { tableServerData: ITableVo[] }
) {
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};
export default Node;
