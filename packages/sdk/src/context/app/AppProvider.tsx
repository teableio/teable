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
  const [connected, setConnected] = useState(false);
  const themeProps = useTheme();

  useEffect(() => {
    if (!connection) {
      const socket = new ReconnectingWebSocket(`ws://${window.location.host}/socket`);
      setConnection(new Connection(socket as Socket));
    }
  }, [connection]);

  useEffect(() => {
    if (!connection) {
      return;
    }
    const onConnected = () => setConnected(true);
    const onDisconnected = () => setConnected(false);
    connection.on('connected', onConnected);
    connection.on('disconnected', onDisconnected);
    connection.on('closed', onDisconnected);
    return () => {
      connection.removeListener('connected', onConnected);
      connection.removeListener('disconnected', onDisconnected);
      connection.removeListener('closed', onDisconnected);
    };
  }, [connection]);

  const value = useMemo(() => {
    return { connection, connected, ...themeProps };
  }, [connection, connected, themeProps]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
