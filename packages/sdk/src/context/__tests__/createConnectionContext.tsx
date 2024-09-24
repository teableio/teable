import type { Connection } from 'sharedb/lib/client';
import { ConnectionContext } from '../app/ConnectionContext';

export const createConnectionContext = (
  context: {
    connection?: Connection;
    connected: boolean;
  } = { connected: false }
) => {
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) => (
    <ConnectionContext.Provider value={context}>{children}</ConnectionContext.Provider>
  );
};
