import type { ITableVo } from '@teable-group/core';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { SsrApi } from '@/backend/api/rest/table.ssr';
import { Dashboard } from '@/features/app/blocks/dashboard/Dashboard';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import type { NextPageWithLayout } from '../_app';

const Node: NextPageWithLayout = () => <Dashboard />;

export const getServerSideProps: GetServerSideProps = async () => {
  const snapshot = await new SsrApi().getTableSnapshot();

  return {
    props: {
      tableServerData: snapshot.tables,
    },
  };
};

Node.getLayout = function getLayout(
  page: ReactElement,
  pageProps: { tableServerData: ITableVo[] }
) {
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};
export default Node;
