import { useMutation } from '@tanstack/react-query';
import { getTableById } from '@teable/openapi';
import { AnchorContext } from '@teable/sdk/context';
import { useView, useViews } from '@teable/sdk/hooks';
import { useRouter } from 'next/router';
import { useRef, useEffect, useContext } from 'react';

export const ViewCheck = (props: { children: React.ReactNode }) => {
  const { children } = props;
  const { baseId, tableId } = useContext(AnchorContext);
  const view = useView();
  const views = useViews();
  const router = useRouter();
  const viewId = view?.id;
  const hasViewList = views.length > 0;
  const ref = useRef(false);

  const { mutate } = useMutation({
    mutationFn: ({ baseId, tableId }: { baseId: string; tableId: string }) =>
      getTableById(baseId, tableId),
    onSuccess: (data) => {
      const defaultViewId = data.data.defaultViewId;
      ref.current = false;
      router.push(
        {
          pathname: '/base/[baseId]/[tableId]/[viewId]',
          query: {
            tableId,
            viewId: defaultViewId,
            baseId,
          },
        },
        undefined,
        { shallow: Boolean(defaultViewId) }
      );
    },
  });
  useEffect(() => {
    if (!viewId && hasViewList && tableId && baseId) {
      ref.current = true;
      mutate({ baseId, tableId });
    }
  }, [viewId, baseId, tableId, mutate, hasViewList]);

  if (!view) {
    return null;
  }

  return children;
};
