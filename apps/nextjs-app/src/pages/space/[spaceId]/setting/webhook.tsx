import { QueryClient, dehydrate } from '@tanstack/react-query';
import { Role } from '@teable/core';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { WebhooksPage } from '@/features/app/blocks/space-setting';
import { SpaceSettingLayout } from '@/features/app/layouts/SpaceSettingLayout';
import { webhookConfig } from '@/features/i18n/webhook.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import { spaceRoleChecker } from '@/lib/space-role-checker';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const Webhook: NextPageWithLayout = () => <WebhooksPage />;

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
          queryKey: ReactQueryKeys.webhookList(spaceId as string),
          queryFn: ({ queryKey }) => ssrApi.getWebhookList(queryKey[1]),
        }),
      ]);

      spaceRoleChecker({
        queryClient,
        spaceId: spaceId as string,
        roles: [Role.Owner],
      });

      return {
        props: {
          dehydratedState: dehydrate(queryClient),
          ...(await getTranslationsProps(context, webhookConfig.i18nNamespaces)),
        },
      };
    })
  )
);

Webhook.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <SpaceSettingLayout {...pageProps}>{page}</SpaceSettingLayout>;
};

export default Webhook;
