import type { ReactNode } from 'react';
import { useMemo } from 'react';

import { OrpcClientProvider } from './OrpcClientContext';
import { getRegularOrpcClient } from '@/lib/orpcClient';

export const RegularOrpcProvider = ({ children }: { children: ReactNode }) => {
  const client = useMemo(() => getRegularOrpcClient(), []);
  return <OrpcClientProvider client={client}>{children}</OrpcClientProvider>;
};
