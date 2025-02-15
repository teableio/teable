import { useQuery } from '@tanstack/react-query';
import { getWebhookList } from '@teable/openapi';
import { ReactQueryKeys, useIsHydrated } from '@teable/sdk';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { type FC, Fragment } from 'react';
import { SpaceSettingContainer } from '@/features/app/components/SpaceSettingContainer';
import { webhookConfig } from '@/features/i18n/webhook.config';
import { DataTable } from './data-table/DataTable';

export const WebhooksPage: FC = () => {
  const router = useRouter();
  const isHydrated = useIsHydrated();
  const { spaceId } = router.query as { spaceId: string };
  const { t } = useTranslation(webhookConfig.i18nNamespaces);

  const { data: webhooks } = useQuery({
    queryKey: ReactQueryKeys.webhookList(spaceId as string),
    queryFn: ({ queryKey }) => getWebhookList(queryKey[1]).then((res) => res.data),
  });

  return (
    <SpaceSettingContainer
      title={t('space:spaceSetting.webhooks')}
      description={t('space:spaceSetting.webhookDescription')}
    >
      {isHydrated && !!webhooks && (
        <Fragment>
          <DataTable />
        </Fragment>
      )}
    </SpaceSettingContainer>
  );
};
