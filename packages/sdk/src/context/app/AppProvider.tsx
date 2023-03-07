import { AppContext } from '../app/AppContext';
import { useEffect, useMemo, useState } from 'react';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { Connection } from 'sharedb/lib/client';
import type { Socket } from 'sharedb/lib/sharedb';
import { useTheme } from './useTheme';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connection, setConnection] = useState(() => {
    if (typeof window === 'object') {
      const socket = new ReconnectingWebSocket(`ws://${window.location.host}/socket`);
      return new Connection(socket as Socket);
    }
  });
  const themeProps = useTheme();

  useEffect(() => {
    if (!connection) {
      const socket = new ReconnectingWebSocket(`ws://${window.location.host}/socket`);
      setConnection(new Connection(socket as Socket));
    }
  }, [connection]);

  const value = useMemo(() => {
    return { connection, ...themeProps };
  }, [connection, themeProps]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
