import { HttpError, HttpErrorCode } from '@teable/core';
import { toast } from '@teable/ui-lib';
import { useEffect, useMemo, useState, useRef } from 'react';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { Connection } from 'sharedb/lib/client';
import type { ConnectionReceiveRequest, Socket } from 'sharedb/lib/sharedb';

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
  const connectionRef = useRef<Connection | null>(null);

  useEffect(() => {
    if (!connectionRef.current && typeof window === 'object') {
      const socket = new ReconnectingWebSocket(path || getWsPath());
      connectionRef.current = new Connection(socket as Socket);
    }

    const connection = connectionRef.current;
    if (!connection) {
      return;
    }

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
      connection.close();
      connectionRef.current = null;
    };
  }, [path]);

  return useMemo(() => {
    return { connection: connectionRef.current || undefined, connected };
  }, [connected]);
};
