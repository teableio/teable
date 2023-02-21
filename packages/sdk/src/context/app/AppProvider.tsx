import { AppContext } from '@/context/app/AppContext';
import { useState } from 'react';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { Connection } from 'sharedb/lib/client';
import type { Socket } from 'sharedb/lib/sharedb';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connection] = useState(() => {
    const socket = new ReconnectingWebSocket('ws://' + window.location.host);
    return new Connection(socket as Socket);
  });

  return <AppContext.Provider value={{ connection }}>{children}</AppContext.Provider>;
};
