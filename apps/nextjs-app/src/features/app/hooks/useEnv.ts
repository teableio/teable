import { useContext } from 'react';
import { EnvContext } from '@/lib/server-env';

export function useEnv() {
  return useContext(EnvContext);
}
