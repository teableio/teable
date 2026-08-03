import { useGridViewStore } from '@teable/sdk/components';
import type { ISelection } from '@teable/sdk/plugin-bridge';
import { useMemo } from 'react';

export const useSelection = () => {
  const { selection } = useGridViewStore();
  return useMemo(() => {
    const res: ISelection | undefined = selection
      ? {
          range: selection.serialize(),
          type: selection.type,
        }
      : undefined;
    return res;
  }, [selection]);
};
