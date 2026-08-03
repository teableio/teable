import { useBasePermission } from '@teable/sdk/hooks';
import type { IChildBridgeMethods } from '@teable/sdk/plugin-bridge';
import { useEffect } from 'react';

export const useSyncBasePermissions = (bridge?: IChildBridgeMethods) => {
  const basePermissions = useBasePermission();
  useEffect(() => {
    if (!basePermissions) {
      return;
    }
    bridge?.syncBasePermissions(basePermissions);
  }, [basePermissions, bridge]);
};
