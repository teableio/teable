import type { IRecord } from '@teable-group/core';
import { ExpandRecorder, IExpandRecordModel } from '@teable-group/sdk';
import { useRouter } from 'next/router';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useState } from 'react';

export interface IExpandRecordContainerRef {
  updateRecordIds: (recordIds: string[] | undefined) => void;
}

const ExpandRecordContainerBase: ForwardRefRenderFunction<
  IExpandRecordContainerRef,
  {
    recordServerData?: IRecord;
  }
> = (props: { recordServerData?: IRecord }, forwardRef) => {
  const { recordServerData } = props;
  const router = useRouter();
  const nodeId = router.query.nodeId as string;
  const viewId = router.query.viewId as string;
  const recordId = router.query.recordId as string;
  const [recordIds, setRecordIds] = useState<string[]>();

  useImperativeHandle(forwardRef, () => ({
    updateRecordIds: setRecordIds,
  }));

  const onClose = useCallback(() => {
    router.push(
      {
        pathname: '/space/[nodeId]/[viewId]',
        query: { nodeId, viewId },
      },
      undefined,
      {
        shallow: Boolean(viewId),
      }
    );
  }, [nodeId, router, viewId]);

  const onUpdateRecordIdCallback = useCallback(
    (recordId: string) => {
      router.push(
        {
          pathname: '/space/[nodeId]/[viewId]/[recordId]',
          query: { nodeId, viewId, recordId },
        },
        undefined,
        {
          shallow: Boolean(viewId),
        }
      );
    },
    [nodeId, router, viewId]
  );

  return (
    <ExpandRecorder
      tableId={nodeId}
      recordId={recordId}
      recordIds={recordIds}
      serverData={recordServerData}
      model={IExpandRecordModel.Modal}
      onClose={onClose}
      onUpdateRecordIdCallback={onUpdateRecordIdCallback}
    />
  );
};

export const ExpandRecordContainer = forwardRef(ExpandRecordContainerBase);
