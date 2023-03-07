import { useContext } from 'react';
import { AppContext } from '../context';

export function useConnection() {
  const { connection } = useContext(AppContext);
  return connection!;
}
