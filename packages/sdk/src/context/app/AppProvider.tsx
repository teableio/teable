import { useEffect, useMemo, useState } from 'react';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { Connection } from 'sharedb/lib/client';
import type { Socket } from 'sharedb/lib/sharedb';
import { Space } from '../../model/space';
import { AppContext } from '../app/AppContext';
import { useTheme } from './useTheme';

function getWsPath() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}/socket`;
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connection, setConnection] = useState(() => {
    if (typeof window === 'object') {
      const socket = new ReconnectingWebSocket(getWsPath());
      return new Connection(socket as Socket);
    }
  });
  const [connected, setConnected] = useState(false);
  const [space, setSpace] = useState<Space>();
  const themeProps = useTheme();

  useEffect(() => {
    if (!connection) {
      const socket = new ReconnectingWebSocket(getWsPath());
      setConnection(new Connection(socket as Socket));
    }
  }, [connection]);

  useEffect(() => {
    if (!connection) {
      return;
    }
    setSpace(new Space(connection));
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
    return { connection, connected, space, ...themeProps };
  }, [connection, connected, space, themeProps]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
