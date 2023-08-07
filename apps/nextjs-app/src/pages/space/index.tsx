import type { ITableVo } from '@teable-group/core';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { SsrApi } from '@/backend/api/rest/table.ssr';
import DashboardPage from '@/features/app/dashboard/Pages';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import type { NextPageWithLayout } from '../_app';

const Space: NextPageWithLayout = () => {
  return <DashboardPage />;
};

export const getServerSideProps: GetServerSideProps = async () => {
  const result = await new SsrApi().getTables();
  if (!result.success) {
    throw new Error('Failed to fetch tables');
  }
  return {
    props: {
      tableServerData: result.data,
    },
  };
};

Space.getLayout = function getLayout(
  page: ReactElement,
  pageProps: { tableServerData: ITableVo[] }
) {
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};

export default Space;
