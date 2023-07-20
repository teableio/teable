import type { ITableVo } from '@teable-group/core';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { SsrApi } from '@/backend/api/rest/table.ssr';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import type { NextPageWithLayout } from '../_app';

const Space: NextPageWithLayout = () => {
  return (
    <div className="grow flex flex-col h-full p-4">
      <h1>Welcome to Teable</h1>
    </div>
  );
};

export const getServerSideProps: GetServerSideProps = async () => {
  const tables = await new SsrApi().getTables();

  return {
    props: {
      tableServerData: tables,
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
