import type {
  IParentBridgeUtilsMethods,
  IParentBridgeUIMethods,
  IParentBridgeMethods,
  IUIConfig,
} from '@teable/sdk/plugin-bridge';
import { useMemo, useRef } from 'react';
import { Chart } from '../../blocks/chart/components/Chart';
import type { IPageParams } from '../../blocks/chart/types';
import { ChartPage as ChartV2Page } from '../../blocks/chart-v2/components/ChartPage';
import type { IPluginParams } from './types';

type IBaseProps = {
  uiConfig: IUIConfig;
  utilsEvent: IParentBridgeUtilsMethods;
  uiEvent: IParentBridgeUIMethods;
};

type IComponentPluginRenderProps = IBaseProps & IPluginParams & { dragging?: boolean };

export const ComponentPluginRender = (props: IComponentPluginRenderProps) => {
  const {
    utilsEvent,
    uiEvent,
    uiConfig,
    positionType,
    pluginId,
    pluginInstallId,
    positionId,
    dragging,
  } = props;
  const baseId = 'baseId' in props ? props.baseId : '';
  const tableId = 'tableId' in props ? props.tableId : '';
  const pageParams: IPageParams = useMemo(
    () => ({
      baseId,
      pluginId,
      pluginInstallId,
      positionId,
      tableId,
      positionType,
    }),
    [baseId, pluginId, pluginInstallId, positionId, tableId, positionType]
  );

  const parentBridgeMethods = useRef<IParentBridgeMethods>({
    ...utilsEvent,
    ...uiEvent,
  });
  parentBridgeMethods.current = {
    ...utilsEvent,
    ...uiEvent,
  };

  if (pluginId === 'plgchartV2') {
    return (
      <ChartV2Page
        parentBridgeMethods={parentBridgeMethods.current}
        uiConfig={uiConfig}
        pageParams={pageParams}
        dragging={dragging}
      />
    );
  }

  return (
    <Chart
      pageParams={pageParams}
      parentBridgeMethods={parentBridgeMethods.current}
      uiConfig={uiConfig}
    />
  );
};
