import type { IViewActionKey } from '@teable/core';
import { useActionListener } from './use-presence';

export const useViewListener = (
  viewId: string | undefined,
  matches: IViewActionKey[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cb: (actionKey: string, payload?: any) => void
) => {
  return useActionListener(viewId, matches, cb);
};
