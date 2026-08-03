import { useContext } from 'react';
import { EvnContext } from '../components/EnvProvider';

export const useEnv = () => {
  return useContext(EvnContext);
};
