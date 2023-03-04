import { AppContext } from '../app/AppContext';
import { useMemo, useState } from 'react';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { Connection } from 'sharedb/lib/client';
import type { Socket } from 'sharedb/lib/sharedb';
import { useTheme } from './useTheme';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connection] = useState(() => {
    const socket = new ReconnectingWebSocket(`ws://${window.location.host}/socket`);
    return new Connection(socket as Socket);
  });
  const themeProps = useTheme();

  const value = useMemo(() => {
    return { connection, ...themeProps };
  }, [connection, themeProps]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
