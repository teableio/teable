import type { IParentBridgeMethods, IUIConfig } from '@teable/sdk';
import { Spin } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useEnv } from '../hooks/useEnv';
import { usePluginInstall } from '../hooks/usePluginInstall';
import type { IPageParams, IChartStorage } from '../types';
import { ChartLayout } from './chart/ChartLayout';
import { ChartPage } from './chart/ChartPage';
import { ChartProvider } from './ChartProvider';
import { EnvProvider } from './EnvProvider';

const ChartInner = (props: { parentBridgeMethods: IParentBridgeMethods; uiConfig: IUIConfig }) => {
  const { parentBridgeMethods, uiConfig } = props;
  const { baseId, positionId, pluginInstallId } = useEnv();
  const { t } = useTranslation('chart');
  const { pluginInstall, isLoading } = usePluginInstall();

  if (!baseId) {
    return <div className="text-center text-muted-foreground">{t('notBaseId')}</div>;
  }

  if (!positionId) {
    return <div className="text-center text-muted-foreground">{t('notPositionId')}</div>;
  }

  if (!pluginInstallId) {
    return <div className="text-center text-muted-foreground">{t('notPluginInstallId')}</div>;
  }

  if (isLoading || !pluginInstall) {
    return (
      <div className="flex size-full items-center justify-center">
        <Spin />
      </div>
    );
  }

  return (
    <ChartProvider
      storage={pluginInstall.storage as unknown as IChartStorage}
      uiConfig={{
        ...uiConfig,
        isShowingSettings: !!uiConfig?.isShowingSettings,
      }}
      parentBridgeMethods={parentBridgeMethods}
    >
      <ChartLayout {...props}>
        <ChartPage />
      </ChartLayout>
    </ChartProvider>
  );
};
export const Chart = (props: {
  pageParams: IPageParams;
  parentBridgeMethods: IParentBridgeMethods;
  uiConfig: IUIConfig;
}) => {
  const { pageParams, parentBridgeMethods, uiConfig } = props;
  return (
    <EnvProvider pageParams={pageParams}>
      <ChartInner parentBridgeMethods={parentBridgeMethods} uiConfig={uiConfig} />
    </EnvProvider>
  );
};
