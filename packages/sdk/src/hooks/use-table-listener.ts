import type { ITableActionKey } from '@teable/core';
import { useActionListener } from './use-presence';

export const useTableListener = (
  tableId: string | undefined,
  matches: ITableActionKey[],
  cb: () => void
) => {
  return useActionListener(tableId, matches, cb);
};
