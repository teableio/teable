import { dehydrate, QueryClient } from '@tanstack/react-query';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { SpaceTrashPage } from '@/features/app/blocks/trash/SpaceTrashPage';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import { spaceConfig } from '@/features/i18n/space.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const SpaceTrash: NextPageWithLayout = () => <SpaceTrashPage />;

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
      const queryClient = new QueryClient();

      await queryClient.fetchQuery({
        queryKey: ReactQueryKeys.spaceList(),
        queryFn: () => ssrApi.getSpaceList(),
      });

      return {
        props: {
          dehydratedState: dehydrate(queryClient),
          ...(await getTranslationsProps(context, spaceConfig.i18nNamespaces)),
        },
      };
    })
  )
);

SpaceTrash.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};

export default SpaceTrash;
