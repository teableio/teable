import { useEffect, useState } from 'react';
import { PluginBridge } from '../bridge';
import type { IPluginBridge } from '../types';

export const usePluginBridge = () => {
  const [bridge, setBridge] = useState<IPluginBridge>();

  useEffect(() => {
    const pluginBridge = new PluginBridge();
    pluginBridge.init().then((bridge) => {
      setBridge(bridge);
    });
    return () => {
      pluginBridge.destroy();
    };
  }, []);

  return bridge;
};
