import { dehydrate, QueryClient } from '@tanstack/react-query';
import { ReactQueryKeys } from '@teable/sdk';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { SpaceInnerPage } from '@/features/app/blocks/space';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import { spaceConfig } from '@/features/i18n/space.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const Node: NextPageWithLayout = () => <SpaceInnerPage />;
export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
      const { spaceId } = context.query;
      const queryClient = new QueryClient();
      await Promise.all([
        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.space(spaceId as string),
          queryFn: ({ queryKey }) => ssrApi.getSpaceById(queryKey[1]),
        }),

        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.baseAll(),
          queryFn: () => ssrApi.getBaseList(),
        }),

        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId as string, {
            skip: 0,
            take: 50,
            orderBy: 'asc',
            includeBase: true,
          }),
          queryFn: ({ queryKey }) => ssrApi.getSpaceCollaboratorList(queryKey[1], queryKey[2]),
        }),

        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.spaceList(),
          queryFn: () => ssrApi.getSpaceList(),
        }),

        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.getPublicSetting(),
          queryFn: () => ssrApi.getPublicSetting(),
        }),
      ]);

      if (process.env.NEXT_BUILD_ENV_EDITION?.toUpperCase() === 'CLOUD') {
        await queryClient.fetchQuery({
          queryKey: ReactQueryKeys.subscriptionSummary(spaceId as string),
          queryFn: ({ queryKey }) => ssrApi.getSubscriptionSummary(queryKey[1]),
        });
      }

      return {
        props: {
          ...(await getTranslationsProps(context, spaceConfig.i18nNamespaces)),
          dehydratedState: dehydrate(queryClient),
        },
      };
    })
  )
);

Node.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};

export default Node;
