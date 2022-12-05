import { useContext } from 'react';
import { TableContext } from '@/context/table';

export function useView(viewId: string) {
  const ctx = useContext(TableContext);
}
