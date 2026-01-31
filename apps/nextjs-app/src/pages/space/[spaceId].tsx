import { dehydrate, QueryClient } from '@tanstack/react-query';
import { Role } from '@teable/core';
import { ReactQueryKeys } from '@teable/sdk';
import { uniq } from 'lodash';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { SpaceInnerPage } from '@/features/app/blocks/space';
import { SpaceInnerLayout } from '@/features/app/layouts/SpaceInnerLayout';
import { settingConfig } from '@/features/i18n/setting.config';
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

      // Fetch space info and base list first to check if auto-creation is needed
      const [space, baseList] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.space(spaceId as string),
          queryFn: ({ queryKey }) => ssrApi.getSpaceById(queryKey[1]),
        }),
        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.baseAll(),
          queryFn: () => ssrApi.getBaseList(),
        }),
        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.recentlyBase(),
          queryFn: () => ssrApi.getRecentlyBase(),
        }),
      ]);

      // Check if user is owner and space has no bases
      const basesInSpace = baseList.filter((base) => base.spaceId === spaceId);
      const isOwner = space.role === Role.Owner;

      // Check if this is a template apply request - skip auto-create if so
      const { action, tid } = context.query;
      const isTemplateApply = action === 'createFromTemplate' && tid;

      // If owner enters an empty space, auto-create a base and redirect
      // Skip auto-create if template apply is requested
      if (isOwner && basesInSpace.length === 0 && !isTemplateApply) {
        const newBase = await ssrApi.createBase({
          spaceId: spaceId as string,
        });
        return {
          redirect: {
            destination: `/base/${newBase.id}`,
            permanent: false,
          },
        };
      }

      await Promise.all([
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
          ...(await getTranslationsProps(
            context,
            uniq([...spaceConfig.i18nNamespaces, ...settingConfig.i18nNamespaces])
          )),
          dehydratedState: dehydrate(queryClient),
        },
      };
    })
  )
);

Node.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <SpaceInnerLayout {...pageProps}>{page}</SpaceInnerLayout>;
};

export default Node;
