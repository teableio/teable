import { useContext } from 'react';
import { ConnectionContext } from '../context/app/ConnectionContext';

export function useConnection() {
  const { connection, connected } = useContext(ConnectionContext);
  return { connection, connected };
}
