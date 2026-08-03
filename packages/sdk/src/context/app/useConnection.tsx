import { HttpError, HttpErrorCode } from '@teable/core';
import { toast } from '@teable/ui-lib';
import { useEffect, useMemo, useState } from 'react';
import { Connection } from 'sharedb/lib/client';
import type { ConnectionReceiveRequest, Socket } from 'sharedb/lib/sharedb';
import { ReconnectingSockJS } from '../../utils/reconnectingSockJS';
import { isConnected, useConnectionAutoManage } from './useConnectionAutoManage';

export function getWsPath() {
  // SockJS uses HTTP/HTTPS protocol for initial handshake
  return `${window.location.origin}/socket`;
}

const ignoreErrorCodes = [HttpErrorCode.VIEW_NOT_FOUND];
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
  if (ignoreErrorCodes) {
    return;
  }
  toast({ title: 'Socket Error', variant: 'destructive', description: `${code}: ${message}` });
};

export const useConnection = (path?: string) => {
  const [connected, setConnected] = useState(false);
  const [connection, setConnection] = useState<Connection>();
  const [socket, setSocket] = useState<ReconnectingSockJS | null>(null);
  useEffect(() => {
    const newSocket = new ReconnectingSockJS(path || getWsPath());
    setSocket(newSocket);

    return () => {
      // Cleanup socket on unmount or path change
      newSocket.destroy();
    };
  }, [path]);

  useConnectionAutoManage(socket, undefined, {
    // 10 minutes, it will be closed when the user is leave the page for 10 minutes
    inactiveTimeout: 10 * 60 * 1000,
    // reconnect when the browser is back for 2 seconds
    reconnectDelay: 2000,
  });

  useEffect(() => {
    if (!socket) {
      return;
    }
    if (!isConnected(socket)) {
      socket.reconnect();
    }
    const connection = new Connection(socket as Socket);
    setConnection(connection);

    let pingInterval: ReturnType<typeof setInterval>;
    const onConnected = () => {
      setConnected(true);
      pingInterval = setInterval(() => connection.ping(), 1000 * 10);
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
      if (connection) {
        isConnected(socket) && connection.close();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (connection as any).bindToSocket({});
      }
    };
  }, [path, socket]);

  return useMemo(() => {
    return { connection, connected };
  }, [connected, connection]);
};
