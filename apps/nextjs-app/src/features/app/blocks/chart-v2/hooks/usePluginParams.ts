import { useContext } from 'react';
import { PluginInstallContext } from './context';

export const usePluginParams = () => {
  const context = useContext(PluginInstallContext);
  const { pageParams } = context || {};
  return pageParams;
};
