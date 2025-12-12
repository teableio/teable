import { useBaseId, useTable, useViews } from '@teable/sdk/hooks';
import { useRouter } from 'next/router';
import { useCallback } from 'react';

export function useDeleteView(viewId: string) {
  const table = useTable();
  const views = useViews();
  const router = useRouter();
  const baseId = useBaseId() as string;

  return useCallback(async () => {
    if (!table || !views) {
      return;
    }

    const currentIndex = views.findIndex((v) => v.id === viewId);
    const nextView = views[currentIndex + 1] ?? views[currentIndex - 1];

    const deletePromise = table.deleteView(viewId);
    if (nextView) {
      router.replace(`/base/${baseId}/table/${table.id}/${nextView.id}`, undefined, {
        shallow: true,
      });
    }

    await deletePromise;
  }, [baseId, router, table, views, viewId]);
}
