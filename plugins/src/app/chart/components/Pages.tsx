'use client';

import { useQuery } from '@tanstack/react-query';
import { ThemeProvider } from '@teable/next-themes';
import { getDashboardInstallPlugin, getPluginPanelPlugin, PluginPosition } from '@teable/openapi';
import type { IUIConfig } from '@teable/sdk';
import { isIframe, usePluginBridge } from '@teable/sdk';
import { Spin } from '@teable/ui-lib';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IPageParams } from '../../../types';
import { ChartLayout } from '../components/chart/ChartLayout';
import { ChartPage } from '../components/chart/ChartPage';
import { ChartProvider } from './ChartProvider';
import type { IChartStorage } from './types';

export const Pages = (props: IPageParams) => {
  const pluginBridge = usePluginBridge();
  const [uiConfig, setUIConfig] = useState<IUIConfig | undefined>();

  useEffect(() => {
    if (!pluginBridge) {
      return;
    }
    const uiConfigListener = (config: IUIConfig) => {
      setUIConfig(config);
    };
    pluginBridge.on('syncUIConfig', uiConfigListener);
    return () => {
      pluginBridge.removeListener('syncUIConfig', uiConfigListener);
    };
  }, [pluginBridge]);

  return (
    <ThemeProvider attribute="class" forcedTheme={uiConfig?.theme ?? props.theme}>
      <Container {...props} uiConfig={uiConfig} />
    </ThemeProvider>
  );
};

const Container = (props: IPageParams & { uiConfig?: IUIConfig }) => {
  const { baseId, positionId, positionType, tableId, pluginInstallId, uiConfig } = props;
  const [isIframeMode, setIsIframeMode] = useState(true);
  const pluginBridge = usePluginBridge();
  const { t } = useTranslation();
  const { data: dashboardPluginInstall, isLoading: isDashboardPluginInstallLoading } = useQuery({
    queryKey: ['plugin-install', baseId, positionId, pluginInstallId],
    queryFn: () =>
      getDashboardInstallPlugin(baseId, positionId, pluginInstallId).then((res) => res.data),
    enabled: Boolean(
      positionType === PluginPosition.Dashboard && baseId && positionId && pluginInstallId
    ),
  });

  const { data: pluginPanelPluginInstall, isLoading: isPluginPanelPluginLoading } = useQuery({
    queryKey: ['plugin-panel-plugin', tableId, positionId, pluginInstallId],
    queryFn: () =>
      getPluginPanelPlugin(tableId!, positionId, pluginInstallId).then((res) => res.data),
    enabled: Boolean(
      positionType === PluginPosition.Panel && tableId && positionId && pluginInstallId
    ),
  });

  const isLoading =
    positionType === PluginPosition.Dashboard
      ? isDashboardPluginInstallLoading
      : isPluginPanelPluginLoading;
  const pluginInstall =
    positionType === PluginPosition.Dashboard ? dashboardPluginInstall : pluginPanelPluginInstall;

  useEffect(() => {
    setIsIframeMode(isIframe);
  }, []);

  if (!baseId) {
    return <div className="text-muted-foreground text-center">{t('notBaseId')}</div>;
  }

  if (!positionId) {
    return <div className="text-muted-foreground text-center">{t('notPositionId')}</div>;
  }

  if (!pluginInstallId) {
    return <div className="text-muted-foreground text-center">{t('notPluginInstallId')}</div>;
  }

  if (!pluginBridge && isIframeMode) {
    return (
      <div className="flex flex-col items-center justify-center">
        <p className="text-muted-foreground text-center">{t('initBridge')}</p>
      </div>
    );
  }

  if (isLoading || !pluginInstall) {
    return <Spin />;
  }

  return (
    <ChartProvider
      storage={pluginInstall?.storage as unknown as IChartStorage}
      uiConfig={{
        ...uiConfig,
        isShowingSettings: isIframeMode ? !!uiConfig?.isShowingSettings : true,
      }}
    >
      <ChartLayout>
        <ChartPage />
      </ChartLayout>
    </ChartProvider>
  );
};
