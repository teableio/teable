import type { ITableActionKey } from '@teable/core';
import { useActionListener } from './use-presence';

export const useTableListener = (
  tableId: string | undefined,
  matches: ITableActionKey[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cb: (actionKey: string, payload?: any) => void
) => {
  return useActionListener(tableId, matches, cb);
};
