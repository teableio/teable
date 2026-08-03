import type { DehydratedState } from '@tanstack/react-query';
import type { IUser } from '@teable/sdk';
import { NotificationProvider, SessionProvider } from '@teable/sdk';
import { AppProvider } from '@teable/sdk/context';
import Head from 'next/head';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { useSdkLocale } from '../hooks/useSdkLocale';
import { AppLayout } from './AppLayout';

export const SpaceTrashLayout: React.FC<{
  children: React.ReactNode;
  user?: IUser;
  dehydratedState?: DehydratedState;
}> = ({ children, user, dehydratedState }) => {
  const sdkLocale = useSdkLocale();
  const { i18n } = useTranslation();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  return (
    <AppLayout>
      <Head>
        <title>{t('common:trash.spaceTrash')}</title>
      </Head>
      <AppProvider locale={sdkLocale} lang={i18n.language} dehydratedState={dehydratedState}>
        <SessionProvider user={user}>
          <NotificationProvider>
            <div id="portal" className="relative flex h-screen w-full items-start">
              {children}
            </div>
          </NotificationProvider>
        </SessionProvider>
      </AppProvider>
    </AppLayout>
  );
};
