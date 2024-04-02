import { HttpError, HttpErrorCode } from '@teable/core';
import { toast } from '@teable/ui-lib';
import { useEffect, useMemo, useState } from 'react';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { Connection } from 'sharedb/lib/client';
import type { ConnectionReceiveRequest, Socket } from 'sharedb/lib/sharedb';

export function getWsPath() {
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
  if (code === HttpErrorCode.UNAUTHORIZED_SHARE) {
    window.location.reload();
    return;
  }
  toast({ title: 'Socket Error', description: `${code}: ${message}` });
};

export const useConnection = (path?: string) => {
  const [connection, setConnection] = useState(() => {
    if (typeof window === 'object') {
      const socket = new ReconnectingWebSocket(path || getWsPath());
      return new Connection(socket as Socket);
    }
  });
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!connection) {
      const socket = new ReconnectingWebSocket(path || getWsPath());
      setConnection(new Connection(socket as Socket));
    }
  }, [connection, path]);

  useEffect(() => {
    if (!connection) {
      return;
    }

    let pingInterval: ReturnType<typeof setInterval>;
    const onConnected = () => {
      setConnected(true);
      pingInterval = setInterval(() => connection.ping(), 1000 * 30);
    };
    const onDisconnected = () => {
      setConnected(false);
      pingInterval && clearInterval(pingInterval);
    };
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
      pingInterval && clearInterval(pingInterval);
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
