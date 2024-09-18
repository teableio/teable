'use client';
import {
  SessionProvider,
  AnchorContext,
  AppProvider,
  BaseProvider,
  TableProvider,
} from '@teable/sdk';
import { useSearchParams } from 'next/navigation';
import React, { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { ChartContext } from '../ChartProvider';

export const ChartLayout: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const searchParams = useSearchParams();
  const baseId = searchParams.get('baseId');
  const { i18n, t } = useTranslation();
  const { uiConfig, storage } = useContext(ChartContext);

  if (!storage && !uiConfig?.isShowingSettings) {
    return <div className="text-muted-foreground text-center">{t('noStorage')}</div>;
  }

  return (
    <AppProvider
      lang={i18n.resolvedLanguage}
      locale={i18n.getDataByLanguage(i18n.resolvedLanguage || i18n.language)?.sdk}
    >
      <SessionProvider>
        <AnchorContext.Provider
          value={{
            baseId: baseId as string,
          }}
        >
          <BaseProvider>
            <TableProvider>
              <div id="portal" className="relative flex h-screen w-full items-start">
                {children}
              </div>
            </TableProvider>
          </BaseProvider>
        </AnchorContext.Provider>
      </SessionProvider>
    </AppProvider>
  );
};
