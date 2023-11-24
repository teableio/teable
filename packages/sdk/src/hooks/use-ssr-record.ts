import { useContext } from 'react';
import { RecordContext } from '../context';

export function useSSRRecord() {
  const { serverRecord } = useContext(RecordContext);
  return serverRecord;
}
