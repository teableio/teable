import type { ITableVo } from '@teable-group/core';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { AutoMationPage } from '@/features/app/automation';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import withAuthSSR from '@/lib/withAuthSSR';
import type { NextPageWithLayout } from '../../_app';

const AutoMation: NextPageWithLayout = (props) => {
  return <AutoMationPage {...props}></AutoMationPage>;
};

export const getServerSideProps: GetServerSideProps = withAuthSSR(async () => {
  return {
    props: {
      title: 'title',
    },
  };
});

AutoMation.getLayout = function getLayout(
  page: ReactElement,
  pageProps: { tableServerData: ITableVo[] }
) {
  console.log('pageProps', pageProps);
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};

export default AutoMation;
