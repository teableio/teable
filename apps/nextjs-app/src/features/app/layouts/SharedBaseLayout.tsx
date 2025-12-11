import type { DehydratedState } from '@tanstack/react-query';
import { Component, Database } from '@teable/icons';
import type { IUser } from '@teable/sdk';
import { NotificationProvider, SessionProvider } from '@teable/sdk';
import { AppProvider } from '@teable/sdk/context';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { Fragment, useMemo } from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { Sidebar } from '../components/sidebar/Sidebar';
import { SidebarContent } from '../components/sidebar/SidebarContent';
import { SidebarHeaderLeft } from '../components/sidebar/SidebarHeaderLeft';
import { SideBarFooter } from '../components/SideBarFooter';
import { useSdkLocale } from '../hooks/useSdkLocale';
import { AppLayout } from './AppLayout';

export const SharedBaseLayout: React.FC<{
  children: React.ReactNode;
  user?: IUser;
  dehydratedState?: DehydratedState;
}> = ({ children, user, dehydratedState }) => {
  const sdkLocale = useSdkLocale();
  const { i18n } = useTranslation();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const router = useRouter();
  const onBack = () => {
    router.push({ pathname: '/space' });
  };

  const routes = useMemo(() => {
    return [
      {
        Icon: Database,
        label: t('space:sharedBase.title'),
        route: `/space/shared-base`,
        pathTo: `/space/shared-base`,
      },
    ];
  }, [t]);

  return (
    <AppLayout>
      <Head>
        <title>{t('space:sharedBase.title')}</title>
      </Head>
      <AppProvider locale={sdkLocale} lang={i18n.language} dehydratedState={dehydratedState}>
        <SessionProvider user={user}>
          <NotificationProvider>
            <div id="portal" className="relative flex h-screen w-full items-start">
              <Sidebar
                headerLeft={
                  <SidebarHeaderLeft
                    title={t('space:sharedBase.title')}
                    icon={<Component className="size-5 shrink-0" />}
                    onBack={onBack}
                  />
                }
              >
                <Fragment>
                  <div className="flex flex-1 flex-col gap-2 divide-y divide-solid overflow-hidden">
                    <SidebarContent routes={routes} />
                  </div>
                  <SideBarFooter />
                </Fragment>
              </Sidebar>
              {children}
            </div>
          </NotificationProvider>
        </SessionProvider>
      </AppProvider>
    </AppLayout>
  );
};
