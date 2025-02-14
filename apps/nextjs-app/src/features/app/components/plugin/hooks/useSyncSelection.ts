import { useGridViewStore } from '@teable/sdk/components';
import type { IChildBridgeMethods } from '@teable/sdk/plugin-bridge';
import { useEffect } from 'react';

export const useSyncSelection = (bridge: IChildBridgeMethods | undefined) => {
  const { selection } = useGridViewStore();
  useEffect(() => {
    if (selection) {
      bridge?.syncSelection(
        selection
          ? {
              range: selection.serialize(),
              type: selection.type,
            }
          : undefined
      );
    }
  }, [selection, bridge]);
};
