import { ViewType } from '@teable/core';
import { BaseNodeResourceType } from '@teable/openapi';
import { useBaseId, useTable, useViews } from '@teable/sdk/hooks';
import { useRouter } from 'next/router';
import { useCallback } from 'react';
import { getNodeUrl } from '../../base/base-node/hooks';

export function useAddView() {
  const table = useTable();
  const baseId = useBaseId() as string;
  const views = useViews();
  const router = useRouter();
  const viewName = views?.[views.length - 1]?.name + ' ' + views?.length;

  return useCallback(
    async (type: ViewType = ViewType.Grid, name?: string) => {
      if (!table) {
        return;
      }

      const viewDoc = (
        await table.createView({
          name: name ?? viewName,
          type,
        })
      ).data;
      const viewId = viewDoc.id;

      const url = getNodeUrl({
        baseId,
        resourceType: BaseNodeResourceType.Table,
        resourceId: table.id,
        viewId,
      });
      if (url) {
        router.push(url, undefined, { shallow: true });
      }
    },
    [router, table, viewName, baseId]
  );
}
