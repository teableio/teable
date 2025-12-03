import { useContext } from 'react';
import { EnvContext } from '../../chart/components/EnvProvider';

export const useEnv = () => {
  return useContext(EnvContext);
};
