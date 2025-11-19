import type { IParentBridgeMethods, IUIConfig } from '@teable/sdk/plugin-bridge';
import { useEffect, useRef, useState } from 'react';
import { EnvProvider } from '../../chart/components/EnvProvider';
import type { IPageParams } from '../../chart/types';
import { PluginInstallContext } from '../hooks/context';
import { ChartConfig } from './ChartConfig';
import { ChartPreview } from './ChartPreview';

interface IChartPageProps {
  parentBridgeMethods: IParentBridgeMethods;
  uiConfig: IUIConfig;
  pageParams: IPageParams;
  dragging?: boolean;
}

export const ChartPage = (props: IChartPageProps) => {
  const { parentBridgeMethods, uiConfig, pageParams, dragging } = props;

  const { isShowingSettings } = uiConfig;
  const [triggerAnimation, setTriggerAnimation] = useState<number>();
  const prevIsShowingSettingsRef = useRef(isShowingSettings);

  useEffect(() => {
    if (prevIsShowingSettingsRef.current !== isShowingSettings) {
      setTriggerAnimation(Date.now());
      prevIsShowingSettingsRef.current = isShowingSettings;
    }
  }, [isShowingSettings]);

  return (
    <EnvProvider pageParams={pageParams}>
      <PluginInstallContext.Provider
        value={{
          parentBridgeMethods,
          pageParams,
          uiConfig,
        }}
      >
        <div className="flex size-full overflow-hidden">
          <ChartPreview
            triggerAnimation={triggerAnimation}
            dragging={dragging}
            isShowingSettings={isShowingSettings}
          />
          {isShowingSettings && <ChartConfig />}
        </div>
      </PluginInstallContext.Provider>
    </EnvProvider>
  );
};
