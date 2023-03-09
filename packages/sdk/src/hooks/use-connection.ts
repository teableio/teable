import { useContext } from 'react';
import { AppContext } from '../context';

export function useConnection() {
  const { connection, connected } = useContext(AppContext);
  return { connection: connection!, connected };
}
