import { ExpandRecordNavigationContext } from '@teable/sdk';
import { useRouter } from 'next/router';
import React, { useCallback, useMemo } from 'react';
import { useTableHref } from '../blocks/table-list/useTableHref';
import { useGridSearchStore } from '../blocks/view/grid/useGridSearchStore';

/**
 * Lets an expanded linked record highlight its table in the sidebar and jump to it.
 * Table hrefs carry the share url prefix, so this works inside a base share too.
 */
export const ExpandRecordNavigationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const router = useRouter();
  const { setHighlightedTableId } = useGridSearchStore();
  // Only a jump from an expanded record needs the last-visited views, so they load on that jump.
  const { loadTableHref } = useTableHref(false);

  const navigateToTable = useCallback(
    async (tableId: string) => {
      const { hrefMap, viewIdMap } = await loadTableHref();
      const url = hrefMap[tableId];
      const viewId = viewIdMap[tableId];
      if (url) {
        router.push({ pathname: url }, undefined, { shallow: Boolean(viewId) });
      }
    },
    [loadTableHref, router]
  );

  const value = useMemo(
    () => ({ onHighlightTable: setHighlightedTableId, navigateToTable }),
    [setHighlightedTableId, navigateToTable]
  );

  return (
    <ExpandRecordNavigationContext.Provider value={value}>
      {children}
    </ExpandRecordNavigationContext.Provider>
  );
};
