import type { ReactNode } from 'react';
import { useMemo } from 'react';

import { OrpcClientProvider } from './OrpcClientContext';
import { getRemoteOrpcClient } from '@/lib/orpcClient';

export const RemoteOrpcProvider = ({ children }: { children: ReactNode }) => {
  const client = useMemo(() => getRemoteOrpcClient(), []);
  return <OrpcClientProvider client={client}>{children}</OrpcClientProvider>;
};
