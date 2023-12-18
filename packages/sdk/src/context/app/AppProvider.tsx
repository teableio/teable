import { Hydrate, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { getDriver } from '../../utils/driver';
import { AppContext } from './AppContext';
import { createQueryClient } from './queryClient';
import { useConnection } from './useConnection';
import { useTheme } from './useTheme';

const queryClient = createQueryClient();

export const AppProvider: React.FC<{
  children: React.ReactNode;
  wsPath?: string;
  dehydratedState?: unknown;
}> = ({ wsPath, children, dehydratedState }) => {
  const { connected, connection } = useConnection(wsPath);
  const themeProps = useTheme();

  useEffect(() => {
    if (!connection) {
      return;
    }
  }, [connection]);

  const value = useMemo(() => {
    return { connection, connected, driver: getDriver(), ...themeProps };
  }, [connection, connected, themeProps]);

  return (
    <AppContext.Provider value={value}>
      <QueryClientProvider client={queryClient}>
        <Hydrate state={dehydratedState}>{children}</Hydrate>
      </QueryClientProvider>
    </AppContext.Provider>
  );
};
