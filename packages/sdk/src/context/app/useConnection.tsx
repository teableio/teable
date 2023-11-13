import { HttpError, HttpErrorCode } from '@teable-group/core';
import { toast } from '@teable-group/ui-lib';
import { useEffect, useMemo, useState } from 'react';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { Connection } from 'sharedb/lib/client';
import type { ConnectionReceiveRequest, Socket } from 'sharedb/lib/sharedb';

function getWsPath() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}/socket`;
}

const shareDbErrorHandler = (error: unknown) => {
  const httpError = new HttpError(error as string, 500);
  const { code, message } = httpError;
  if (code === HttpErrorCode.UNAUTHORIZED) {
    window.location.href = `/auth/login?redirect=${encodeURIComponent(window.location.href)}`;
    return;
  }
  toast({ title: 'Socket Error', description: `${code}: ${message}` });
};

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
    const onReceive = (request: ConnectionReceiveRequest) => {
      if (request.data.error) {
        shareDbErrorHandler(request.data.error);
      }
    };

    connection.on('connected', onConnected);
    connection.on('disconnected', onDisconnected);
    connection.on('closed', onDisconnected);
    connection.on('error', shareDbErrorHandler);
    connection.on('receive', onReceive);
    return () => {
      connection.removeListener('connected', onConnected);
      connection.removeListener('disconnected', onDisconnected);
      connection.removeListener('closed', onDisconnected);
      connection.removeListener('error', shareDbErrorHandler);
      connection.removeListener('receive', onReceive);
    };
  }, [connection]);

  return useMemo(() => {
    return { connection, connected };
  }, [connected, connection]);
};
