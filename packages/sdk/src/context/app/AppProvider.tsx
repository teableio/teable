import { QueryClientProvider } from '@tanstack/react-query';
import type { UndoManager } from '@teable/sharedb/lib/client';
import { useEffect, useMemo, useState } from 'react';
import { AppContext } from '../app/AppContext';
import { useConnection } from './useConnection';
import { useQueryClient } from './useQueryClient';
import { useTheme } from './useTheme';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { connected, connection } = useConnection();
  const [undoManager, setUndoManager] = useState<UndoManager>();
  const themeProps = useTheme();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!connection) {
      return;
    }
    setUndoManager(
      connection.createUndoManager({
        limit: 10000,
        composeInterval: 1000,
      })
    );
  }, [connection]);

  const value = useMemo(() => {
    return { connection, connected, undoManager, ...themeProps };
  }, [connection, connected, undoManager, themeProps]);

  return (
    <AppContext.Provider value={value}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AppContext.Provider>
  );
};
