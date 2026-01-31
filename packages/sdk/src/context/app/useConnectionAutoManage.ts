import { useEffect, useRef } from 'react';
import { useDocumentVisible } from '../../hooks/use-document-visible';
import { ReadyState } from '../../utils/reconnectingSockJS';
import type { ReconnectingSockJS } from '../../utils/reconnectingSockJS';

export const isConnected = (socket: ReconnectingSockJS) => {
  return [ReadyState.OPEN, ReadyState.CONNECTING].includes(socket.readyState);
};

export const useConnectionAutoManage = (
  connection: ReconnectingSockJS | null,
  reconnect: () => void,
  {
    inactiveTimeout,
    reconnectDelay,
  }: {
    inactiveTimeout?: number;
    reconnectDelay?: number;
  } = {
    inactiveTimeout: 10 * 60 * 1000,
    reconnectDelay: 1000,
  }
) => {
  const visible = useDocumentVisible();
  const inactiveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const connectionRef = useRef<ReconnectingSockJS | null>(connection);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  useEffect(() => {
    const connection = connectionRef.current;
    if (!connection) return;

    if (inactiveTimerRef.current) {
      clearTimeout(inactiveTimerRef.current);
      inactiveTimerRef.current = null;
    }

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (visible && !isConnected(connection)) {
      reconnectTimerRef.current = setTimeout(() => {
        // Use `ref` to obtain the latest connection and avoid closure expiration issues.
        const currentConnection = connectionRef.current;
        if (currentConnection && !isConnected(currentConnection)) {
          reconnect();
        }
      }, reconnectDelay);
    }
    if (!visible && isConnected(connection)) {
      inactiveTimerRef.current = setTimeout(() => {
        // Use `ref` to obtain the latest connection and avoid closure expiration issues.
        const currentConnection = connectionRef.current;
        if (currentConnection && isConnected(currentConnection)) {
          currentConnection.close();
        }
      }, inactiveTimeout);
    }

    return () => {
      if (inactiveTimerRef.current) {
        clearTimeout(inactiveTimerRef.current);
        inactiveTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [visible, inactiveTimeout, reconnectDelay, reconnect]);
};
