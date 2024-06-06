import type { IViewActionKey } from '@teable/core';
import { useActionListener } from './use-presence';

export const useViewListener = (
  viewId: string | undefined,
  matches: IViewActionKey[],
  cb: () => void
) => {
  return useActionListener(viewId, matches, cb);
};
