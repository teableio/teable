'use client';
import {
  SessionProvider,
  AnchorContext,
  AppProvider,
  BaseProvider,
  TableProvider,
  usePluginBridge,
} from '@teable/sdk';
import { Button } from '@teable/ui-lib';
import { useSearchParams } from 'next/navigation';
import React, { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { ChartContext } from '../ChartProvider';
import type { IChartServerData } from '../types';

export const ChartLayout: React.FC<
  {
    children: React.ReactNode;
  } & IChartServerData
> = ({ children, tableServerData }) => {
  const searchParams = useSearchParams();
  const baseId = searchParams.get('baseId');
  const { i18n, t } = useTranslation();
  const { uiConfig, storage } = useContext(ChartContext);
  const pluginBridge = usePluginBridge();

  if (!storage && !uiConfig?.isShowingSettings) {
    return (
      <div className="flex flex-col items-center gap-2 px-4">
        <div className="text-muted-foreground text-center">{t('noStorage')}</div>
        <Button className="m-auto h-7" size="sm" onClick={() => pluginBridge?.expandPlugin()}>
          {t('goConfig')}
        </Button>
      </div>
    );
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
            <TableProvider serverData={tableServerData}>
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
