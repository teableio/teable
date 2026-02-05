import type { ReactNode } from 'react';
import { useMemo } from 'react';

import { OrpcClientProvider } from './OrpcClientContext';
import { getSandboxOrpcClient } from '@/lib/sandboxOrpcClient';

export const SandboxOrpcProvider = ({ children }: { children: ReactNode }) => {
  const client = useMemo(() => getSandboxOrpcClient(), []);
  return <OrpcClientProvider client={client}>{children}</OrpcClientProvider>;
};
