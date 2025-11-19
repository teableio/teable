import { useContext } from 'react';
import { PluginInstallContext } from './context';

export const useUiConfig = () => {
  return useContext(PluginInstallContext)?.uiConfig;
};
