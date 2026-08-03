import type { IParentBridgeUIMethods } from '@teable/sdk/plugin-bridge';
import { useEffect, useRef } from 'react';

export const useUIEvent = (params: { onExpandPlugin?: () => void }) => {
  const { onExpandPlugin } = params;
  const ref = useRef<IParentBridgeUIMethods>({
    expandRecord: () => {
      console.log('initializing expandRecord method');
    },
    expandPlugin: () => {
      console.log('initializing expandPlugin method');
    },
  });

  useEffect(() => {
    ref.current.expandRecord = (recordIds) => {
      console.log('expandRecord', recordIds);
    };
    if (onExpandPlugin) {
      ref.current.expandPlugin = () => {
        onExpandPlugin();
      };
    }
  }, [onExpandPlugin]);

  return ref.current;
};
