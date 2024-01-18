import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { SpacePage } from '@/features/app/blocks/space';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import { spaceConfig } from '@/features/i18n/space.config';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '../_app';

const Space: NextPageWithLayout = () => {
  return <SpacePage />;
};
export const getServerSideProps: GetServerSideProps = async (context) => {
  return {
    props: {
      ...(await getTranslationsProps(context, spaceConfig.i18nNamespaces)),
    },
  };
};

Space.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};

export default Space;
