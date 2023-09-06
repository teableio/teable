import type { UndoManager } from '@teable/sharedb/lib/client';
import { useEffect, useMemo, useState } from 'react';
import { QueryClientProvider } from 'react-query';
import { Space } from '../../model/space';
import { AppContext } from '../app/AppContext';
import { useConnection } from './useConnection';
import { useQueryClient } from './useQueryClient';
import { useTheme } from './useTheme';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { connected, connection } = useConnection();
  const [space, setSpace] = useState<Space>();
  const [undoManager, setUndoManager] = useState<UndoManager>();
  const themeProps = useTheme();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!connection) {
      return;
    }
    setSpace(new Space());
    setUndoManager(
      connection.createUndoManager({
        limit: 10000,
        composeInterval: 1000,
      })
    );
  }, [connection]);

  const value = useMemo(() => {
    return { connection, connected, space, undoManager, ...themeProps };
  }, [connection, connected, space, undoManager, themeProps]);

  return (
    <AppContext.Provider value={value}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AppContext.Provider>
  );
};
