import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { SharedBasePage } from '@/features/app/blocks/space/SharedBasePage';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import { spaceConfig } from '@/features/i18n/space.config';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';

const Node: NextPageWithLayout = () => <SharedBasePage />;

export const getServerSideProps: GetServerSideProps = async (context) => {
  return {
    props: {
      ...(await getTranslationsProps(context, spaceConfig.i18nNamespaces)),
    },
  };
};

Node.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};
export default Node;
