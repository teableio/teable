import type { IBasePermissions } from '@teable/sdk';
import { usePluginBridge } from '@teable/sdk';
import { useEffect, useState } from 'react';

export const useBasePermissions = () => {
  const pluginBridge = usePluginBridge();
  const [basePermission, setBasePermission] = useState<IBasePermissions>();

  useEffect(() => {
    if (!pluginBridge) {
      return;
    }
    const basePermissionsListener = (config: IBasePermissions) => {
      setBasePermission(config);
    };
    pluginBridge.on('syncBasePermissions', basePermissionsListener);
    return () => {
      pluginBridge.removeListener('syncBasePermissions', basePermissionsListener);
    };
  }, [pluginBridge]);

  return basePermission;
};
