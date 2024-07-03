import { dehydrate, QueryClient } from '@tanstack/react-query';
import { ReactQueryKeys } from '@teable/sdk';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { SpaceSettingsPage } from '@/features/app/blocks/setting/space/SpaceSettingsPage';
import { SpaceSettingLayout } from '@/features/app/layouts/SpaceSettingLayout';
import { webhookConfig } from '@/features/i18n/webhook.config';
import { spaceSettingNavConfig } from '@/features/system/dynamic-routes/space-setting-nav.config';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';

const Node: NextPageWithLayout = () => <SpaceSettingsPage />;
export const getServerSideProps: GetServerSideProps = withAuthSSR(async (context, ssrApi) => {
  const { spaceId, setting } = context.query;
  if (setting && setting?.length > 1) {
    return {
      notFound: true,
    };
  }

  const queryClient = new QueryClient();

  const validPage = Object.values(spaceSettingNavConfig(spaceId as string))
    .flat()
    .map((item) => item.page)
    .filter(Boolean);

  if (setting && !validPage.includes(setting[0])) {
    return {
      notFound: true,
    };
  }

  await queryClient.fetchQuery({
    queryKey: ReactQueryKeys.webhookList(spaceId as string),
    queryFn: ({ queryKey }) => ssrApi.webhook.getWebhookList(queryKey[1]),
  });

  return {
    props: {
      dehydratedState: dehydrate(queryClient),
      ...(await getTranslationsProps(context, webhookConfig.i18nNamespaces)),
    },
  };
});

Node.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <SpaceSettingLayout {...pageProps}>{page}</SpaceSettingLayout>;
};
export default Node;
