import type { DehydratedState } from '@tanstack/react-query';
import type { IUser } from '@teable/sdk';
import { AppProvider, SessionProvider } from '@teable/sdk';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { AppLayout } from '@/features/app/layouts';
import { useSdkLocale } from '../hooks/useSdkLocale';

/**
 * A page on its own: the app's providers and nothing else around it — no sidebar, no
 * navigation between siblings, because it has none. For a page that is one task from start
 * to finish (deleting the account), which the phone app opens by itself and which should
 * read the same way on a desktop: as that task, not as one tab of the settings.
 */
export const PlainLayout: React.FC<{
  children: React.ReactNode;
  user?: IUser;
  dehydratedState?: DehydratedState;
}> = ({ children, user, dehydratedState }) => {
  const sdkLocale = useSdkLocale();
  const { i18n } = useTranslation();

  return (
    <AppLayout>
      <AppProvider lang={i18n.language} locale={sdkLocale} dehydratedState={dehydratedState}>
        <SessionProvider user={user}>
          <div id="portal" className="relative flex h-screen w-full items-start">
            {children}
          </div>
        </SessionProvider>
      </AppProvider>
    </AppLayout>
  );
};
