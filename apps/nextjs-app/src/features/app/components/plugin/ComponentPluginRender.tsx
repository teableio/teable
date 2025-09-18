import type {
  IParentBridgeUtilsMethods,
  IParentBridgeUIMethods,
  IParentBridgeMethods,
  IUIConfig,
} from '@teable/sdk/plugin-bridge';
import { useMemo, useRef } from 'react';
import { Chart } from '../../blocks/chart/components/Chart';
import type { IPageParams } from '../../blocks/chart/types';
import type { IPluginParams } from './types';

type IBaseProps = {
  uiConfig: IUIConfig;
  utilsEvent: IParentBridgeUtilsMethods;
  uiEvent: IParentBridgeUIMethods;
};

type IComponentPluginRenderProps = IBaseProps & IPluginParams;

export const ComponentPluginRender = (props: IComponentPluginRenderProps) => {
  const { utilsEvent, uiEvent, uiConfig, positionType, pluginId, pluginInstallId, positionId } =
    props;
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

  return (
    <Chart
      pageParams={pageParams}
      parentBridgeMethods={parentBridgeMethods.current}
      uiConfig={uiConfig}
    />
  );
};
