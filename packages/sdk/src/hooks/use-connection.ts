import { useContext } from 'react';
import { ConnectionContext } from '../context/app/ConnectionContext';

export function useConnection() {
  const { connection, connected } = useContext(ConnectionContext);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return { connection: connection!, connected };
}
