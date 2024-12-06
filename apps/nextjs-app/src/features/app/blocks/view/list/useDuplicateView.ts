import type { IViewInstance } from '@teable/sdk';
import { useTable } from '@teable/sdk/hooks';
import { pick } from 'lodash';
import { useRouter } from 'next/router';
import { useCallback } from 'react';

export function useDuplicateView(view: IViewInstance) {
  const table = useTable();
  const router = useRouter();

  const newView = pick(view, [
    'type',
    'columnMeta',
    'description',
    'filter',
    'group',
    'name',
    'options',
    'sort',
  ]);

  return useCallback(async () => {
    if (!table) return;

    const viewDoc = (await table.createView(newView)).data;
    const viewId = viewDoc.id;
    const { baseId } = router.query;
    router.push(
      {
        pathname: '/base/[baseId]/[tableId]/[viewId]',
        query: { baseId, tableId: table.id, viewId },
      },
      undefined,
      { shallow: Boolean(router.query.viewId) }
    );
  }, [router, table, newView]);
}
