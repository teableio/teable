import type { IPublicFileProgress, ITableActionKey } from '@teable/core';
import { PUBLIC_FILE_PROGRESS } from '@teable/core';
import { useTableListener } from '@teable/sdk/hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * The whole-field copies of public attachment files running on the table, by field id, as the
 * backend pushes them: as a copy starts, after each page and at its end. A grid opened or reloaded
 * mid-copy shows it from the next push on.
 */
export const usePublicFileProgress = (tableId: string | undefined) => {
  const [progress, setProgress] = useState<Record<string, IPublicFileProgress>>({});
  useEffect(() => setProgress({}), [tableId]);

  const matches = useMemo<ITableActionKey[]>(() => [PUBLIC_FILE_PROGRESS], []);
  const onProgress = useCallback((_actionKey: string, payload?: IPublicFileProgress) => {
    if (!payload?.fieldId) return;
    setProgress(({ [payload.fieldId]: _, ...rest }) =>
      payload.done >= payload.total ? rest : { ...rest, [payload.fieldId]: payload }
    );
  }, []);
  useTableListener(tableId, matches, onProgress);

  return progress;
};
