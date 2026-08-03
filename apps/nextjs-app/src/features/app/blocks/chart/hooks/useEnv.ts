import { useContext } from 'react';
import { EnvContext } from '../components/EnvProvider';

export const useEnv = () => {
  return useContext(EnvContext);
};
