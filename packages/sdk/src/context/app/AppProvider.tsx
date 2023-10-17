import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { getDriver } from '../../utils/driver';
import { AppContext } from '../app/AppContext';
import { createQueryClient } from './queryClient';
import { useConnection } from './useConnection';
import { useTheme } from './useTheme';

const queryClient = createQueryClient();

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { connected, connection } = useConnection();
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
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AppContext.Provider>
  );
};
