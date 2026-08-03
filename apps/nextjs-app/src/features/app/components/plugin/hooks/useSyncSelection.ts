import type { IChildBridgeMethods } from '@teable/sdk/plugin-bridge';
import { useEffect } from 'react';
import { useSelection } from './useSelection';

export const useSyncSelection = (bridge: IChildBridgeMethods | undefined) => {
  const selection = useSelection();
  useEffect(() => {
    bridge?.syncSelection(selection);
  }, [selection, bridge]);
};
