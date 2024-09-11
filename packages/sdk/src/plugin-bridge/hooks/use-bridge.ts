import { useEffect, useState } from 'react';
import { PluginBridge } from '../bridge';
import type { IPluginBridge } from '../types';

// eslint-disable-next-line @typescript-eslint/naming-convention
let bridge_s: IPluginBridge | undefined;

export const usePluginBridge = () => {
  const [bridge, setBridge] = useState<IPluginBridge | undefined>(bridge_s);

  useEffect(() => {
    if (bridge_s) {
      return;
    }
    const pluginBridge = new PluginBridge();
    pluginBridge.init().then((bridge) => {
      setBridge(bridge);
      bridge_s = bridge;
    });
    return () => {
      pluginBridge.destroy();
    };
  }, []);

  return bridge;
};
