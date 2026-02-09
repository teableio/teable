import type { ContractRouterClient } from '@orpc/contract';
import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

type V2ContractRouter = (typeof import('@teable/v2-contract-http'))['v2Contract'];
type V2OrpcClient = ContractRouterClient<V2ContractRouter>;

const OrpcClientContext = createContext<V2OrpcClient | null>(null);

export const OrpcClientProvider = ({
  client,
  children,
}: {
  client: V2OrpcClient;
  children: ReactNode;
}) => {
  return <OrpcClientContext.Provider value={client}>{children}</OrpcClientContext.Provider>;
};

export const useOrpcClient = (): V2OrpcClient => {
  const client = useContext(OrpcClientContext);
  if (!client) {
    throw new Error('OrpcClientProvider is missing.');
  }
  return client;
};
