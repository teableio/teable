import type { ITableVo } from '@teable-group/core';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { SsrApi } from '@/backend/api/rest/table.ssr';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import type { NextPageWithLayout } from '../_app';

const Space: NextPageWithLayout = () => {
  return (
    <div className="grow flex flex-col h-full p-4 basis-[600px]">
      <h1>Welcome to Teable</h1>
    </div>
  );
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
