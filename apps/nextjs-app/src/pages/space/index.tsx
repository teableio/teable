import { dehydrate, QueryClient } from '@tanstack/react-query';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { SpacePage } from '@/features/app/blocks/space';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import { spaceConfig } from '@/features/i18n/space.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const Space: NextPageWithLayout = () => {
  return <SpacePage />;
};
export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
      const queryClient = new QueryClient();

      await Promise.all([
        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.spaceList(),
          queryFn: () => ssrApi.getSpaceList(),
        }),

        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.baseAll(),
          queryFn: () => ssrApi.getBaseList(),
        }),

        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.pinList(),
          queryFn: () => ssrApi.getPinList(),
        }),

        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.getPublicSetting(),
          queryFn: () => ssrApi.getPublicSetting(),
        }),

        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.recentlyBase(),
          queryFn: () => ssrApi.getRecentlyBase(),
        }),
      ]);

      if (process.env.NEXT_BUILD_ENV_EDITION?.toUpperCase() === 'CLOUD') {
        await queryClient.fetchQuery({
          queryKey: ReactQueryKeys.subscriptionSummaryList(),
          queryFn: () => ssrApi.getSubscriptionSummaryList(),
        });
      }

      return {
        props: {
          dehydratedState: dehydrate(queryClient),
          ...(await getTranslationsProps(context, spaceConfig.i18nNamespaces)),
        },
      };
    })
  )
);

Space.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};

export default Space;
