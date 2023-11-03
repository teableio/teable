import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { AutoMationPage } from '@/features/app/automation';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import type { IViewPageProps } from '@/lib/view-pages-data';
import withAuthSSR from '@/lib/withAuthSSR';
import type { NextPageWithLayout } from '../../../_app';

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

AutoMation.getLayout = function getLayout(page: ReactElement, pageProps: IViewPageProps) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};

export default AutoMation;
