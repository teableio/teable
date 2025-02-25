import type { IGetTempTokenVo } from '@teable/openapi';
import {
  getTempToken,
  pluginGetAuthCode,
  PluginPosition,
  updateDashboardPluginStorage,
  updatePluginPanelStorage,
} from '@teable/openapi';
import type { IParentBridgeUtilsMethods } from '@teable/sdk/plugin-bridge';
import { useEffect, useRef } from 'react';
import type { IPluginParams } from '../types';

export const useUtilsEvent = (params: IPluginParams) => {
  const tempTokenCacheRef = useRef<IGetTempTokenVo | null>(null);
  const ref = useRef<IParentBridgeUtilsMethods>({
    updateStorage: () => {
      console.log('Initializing updateStorage method');
      return Promise.resolve({});
    },
    getAuthCode: () => {
      console.log('Initializing getAuthCode method');
      return Promise.resolve('');
    },
    getSelfTempToken: () => {
      const tempTokenCache = tempTokenCacheRef.current;
      if (tempTokenCache && new Date(tempTokenCache.expiresTime).getTime() > Date.now() + 60000) {
        return Promise.resolve(tempTokenCache);
      }
      return getTempToken().then((res) => {
        tempTokenCacheRef.current = res.data;
        return res.data;
      });
    },
  });
  const { positionId, positionType, pluginId } = params;
  const pluginInstallId = 'pluginInstallId' in params ? params.pluginInstallId : undefined;
  const shareId = 'shareId' in params ? params.shareId : undefined;
  const baseId = 'baseId' in params ? params.baseId : undefined;
  const tableId = 'tableId' in params ? params.tableId : undefined;

  useEffect(() => {
    ref.current.updateStorage = (storage) => {
      if (shareId) {
        console.error('Share plugin does not support updateStorage');
        return Promise.resolve({});
      }
      switch (positionType) {
        case PluginPosition.Dashboard:
          return updateDashboardPluginStorage(baseId!, positionId, pluginInstallId!, storage).then(
            (res) => res.data.storage ?? {}
          );
        case PluginPosition.Panel:
          return updatePluginPanelStorage(tableId!, positionId, pluginInstallId!, { storage }).then(
            (res) => res.data.storage ?? {}
          );
        default:
          console.error(`Unsupported position type: ${positionType}`);
          return Promise.resolve({});
      }
    };
    ref.current.getAuthCode = () => {
      // TODO: plugin in share page need to get auth code from share page, need plugin id and shareId to get auth code
      if (shareId) {
        console.error('Share plugin does not support getAuthCode');
        return Promise.resolve('');
      }
      return pluginGetAuthCode(pluginId, baseId!).then((res) => res.data);
    };
  }, [shareId, pluginId, positionId, tableId, positionType, pluginInstallId, baseId]);

  return ref.current;
};
