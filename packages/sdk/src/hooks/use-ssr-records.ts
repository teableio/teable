import { useContext } from 'react';
import { RecordContext } from '../context';

export function useSSRRecords() {
  const { serverRecords } = useContext(RecordContext);
  return serverRecords;
}
