import { getUniqName } from '@teable/core';
import { useBase, useTables } from '@teable/sdk/hooks';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback } from 'react';

export function useAddTable() {
  const base = useBase();
  const tables = useTables();
  const router = useRouter();
  const { baseId } = router.query;
  const { t } = useTranslation('table');

  return useCallback(async () => {
    const uniqueName = getUniqName(
      t('table.newTableLabel'),
      tables.map((table) => table.name)
    );
    const tableData = (
      await base.createTable({
        name: uniqueName,
      })
    ).data;
    const tableId = tableData.id;
    const viewId = tableData.defaultViewId;
    router.push(
      {
        pathname: '/base/[baseId]/[tableId]/[viewId]',
        query: { baseId, tableId, viewId },
      },
      undefined,
      {
        shallow: Boolean(router.query.viewId),
      }
    );
  }, [baseId, router, base]);
}
