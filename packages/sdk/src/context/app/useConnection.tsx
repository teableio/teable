import { HttpError, HttpErrorCode } from '@teable/core';
import { toast } from '@teable/ui-lib';
import { debounce } from 'lodash';
import { useEffect, useMemo, useState, useCallback } from 'react';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { Connection } from 'sharedb/lib/client';
import type { ConnectionReceiveRequest, Socket } from 'sharedb/lib/sharedb';
import { isConnected, useConnectionAutoManage } from './useConnectionAutoManage';

export function getWsPath() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}/socket`;
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
  const [socket, setSocket] = useState<ReconnectingWebSocket | null>(null);
  const [refreshTime, setRefreshTime] = useState(Date.now());

  useEffect(() => {
    setSocket((prev) => {
      if (prev) {
        return prev;
      }
      return new ReconnectingWebSocket(path || getWsPath());
    });
  }, [path]);

  const updateRefreshTime = useMemo(() => {
    return debounce(() => setRefreshTime(Date.now()), 1000);
  }, []);

  const updateShareDb = useCallback(() => {
    if (socket && isConnected(socket)) {
      socket.close();
    }
    setConnection(undefined);
    updateRefreshTime();
  }, [socket, updateRefreshTime]);

  useConnectionAutoManage(socket, updateShareDb, {
    // 10 minutes, it will be closed when the user is leave the page for 1 hour
    inactiveTimeout: 1000 * 60 * 60,
    // reconnect when the browser is back for 2 seconds
    reconnectDelay: 2000,
  });

  useEffect(() => {
    if (!socket) {
      return;
    }
    if (socket && !isConnected(socket)) {
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
      // setConnection(undefined);
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
  }, [path, socket, refreshTime]);

  return useMemo(() => {
    return { connection, connected };
  }, [connected, connection]);
};
