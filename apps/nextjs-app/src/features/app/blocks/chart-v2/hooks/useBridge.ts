import { useContext } from 'react';
import { PluginInstallContext } from './context';

export const useBridge = () => {
  return useContext(PluginInstallContext)?.parentBridgeMethods;
};
