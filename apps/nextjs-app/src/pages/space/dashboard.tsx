import type { ITableVo } from '@teable-group/core';
import type { ReactElement } from 'react';
import DashboardPage from '@/features/app/dashboard/Pages';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import type { NextPageWithLayout } from '../_app';

const Node: NextPageWithLayout = () => <DashboardPage />;

Node.getLayout = function getLayout(
  page: ReactElement,
  pageProps: { tableServerData: ITableVo[] }
) {
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};
export default Node;
