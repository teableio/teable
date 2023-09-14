import { Connection } from '@teable/sharedb/lib/client';
import type { Socket } from '@teable/sharedb/lib/sharedb';
import { useEffect, useMemo, useState } from 'react';
import ReconnectingWebSocket from 'reconnecting-websocket';

function getWsPath() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}/socket`;
}

export const useConnection = () => {
  const [connection, setConnection] = useState(() => {
    if (typeof window === 'object') {
      const socket = new ReconnectingWebSocket(getWsPath());
      return new Connection(socket as Socket);
    }
  });
  const [connected, setConnected] = useState(false);

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

  return useMemo(() => {
    return { connection, connected };
  }, [connected, connection]);
};
