import type { IChildBridgeMethods } from '@teable/sdk/plugin-bridge';
import { useEffect } from 'react';
import type { IPluginParams } from '../types';
import { useUIConfig } from './useUIConfig';

export const useSyncUIConfig = (
  bridge: IChildBridgeMethods | undefined,
  pluginParams: IPluginParams
) => {
  const uiConfig = useUIConfig(pluginParams);

  useEffect(() => {
    bridge?.syncUIConfig(uiConfig);
  }, [bridge, uiConfig]);
};
