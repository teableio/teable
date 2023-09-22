import type { ITableVo } from '@teable-group/core';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
// import { ssrApi } from '@/backend/api/rest/table.ssr';
import { AutoMationPage } from '@/features/app/automation';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import withAuthSSR from '@/lib/withAuthSSR';
import type { NextPageWithLayout } from '../../../_app';

const AutoMation: NextPageWithLayout = () => {
  return <AutoMationPage></AutoMationPage>;
};

export const getServerSideProps: GetServerSideProps = withAuthSSR(async () => {
  // const result = await ssrApi.getTables();
  return {
    props: {
      title: 'My Title',
    },
  };
});

AutoMation.getLayout = function getLayout(
  page: ReactElement,
  pageProps: { tableServerData: ITableVo[] }
) {
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};

export default AutoMation;
