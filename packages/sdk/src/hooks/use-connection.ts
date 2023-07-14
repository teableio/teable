import { useContext } from 'react';
import { AppContext } from '../context';

export function useConnection() {
  const { connection, connected } = useContext(AppContext);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return { connection: connection!, connected };
}
