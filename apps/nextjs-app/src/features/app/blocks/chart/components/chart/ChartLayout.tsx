'use client';
import { Button } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import React, { useContext } from 'react';
import { ChartContext } from '../ChartProvider';

export const ChartLayout: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const { t } = useTranslation('chart');
  const { uiConfig, storage, parentBridgeMethods } = useContext(ChartContext);

  if (!storage && !uiConfig?.isShowingSettings) {
    return (
      <div className="flex flex-col items-center gap-2 px-4">
        <div className="text-center text-muted-foreground">{t('noStorage')}</div>
        <Button
          className="m-auto h-7"
          size="sm"
          onClick={() => parentBridgeMethods?.expandPlugin()}
        >
          {t('goConfig')}
        </Button>
      </div>
    );
  }

  return (
    <div id="portal" className="relative flex size-full items-start">
      {children}
    </div>
  );
};
