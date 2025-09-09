import type { IChildBridgeMethods } from '@teable/sdk/plugin-bridge';
import { useEffect } from 'react';
import { useUrlParams } from './useUrlParams';

export const useSyncUrlParams = (bridge?: IChildBridgeMethods) => {
  const urlParams = useUrlParams();

  useEffect(() => {
    bridge?.syncUrlParams(urlParams);
  }, [urlParams, bridge]);
};
