import { dehydrate, QueryClient } from '@tanstack/react-query';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { SpaceInnerTrashPage } from '@/features/app/blocks/trash/SpaceInnerTrashPage';
import { SpaceInnerLayout } from '@/features/app/layouts/SpaceInnerLayout';
import { spaceConfig } from '@/features/i18n/space.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const SpaceTrash: NextPageWithLayout = () => <SpaceInnerTrashPage />;

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
  return <SpaceInnerLayout {...pageProps}>{page}</SpaceInnerLayout>;
};

export default SpaceTrash;
