import type { IRecord } from '@teable/core';
import { ExpandRecorder, ExpandRecordModel } from '@teable/sdk';
import { useRouter } from 'next/router';
import { forwardRef, useImperativeHandle, useState } from 'react';
import type { IExpandRecordContainerRef } from './types';

export const ExpandRecordContainerBase = forwardRef<
  IExpandRecordContainerRef,
  {
    tableId: string;
    viewId?: string;
    recordServerData?: IRecord;
    onClose?: () => void;
    onUpdateRecordIdCallback?: (recordId: string) => void;
  }
>((props, forwardRef) => {
  const { tableId, viewId, recordServerData, onClose, onUpdateRecordIdCallback } = props;
  const router = useRouter();
  const recordId = router.query.recordId as string;
  const commentId = router.query.commentId as string;
  const [recordIds, setRecordIds] = useState<string[]>();

  useImperativeHandle(forwardRef, () => ({
    updateRecordIds: setRecordIds,
  }));

  return (
    <ExpandRecorder
      tableId={tableId}
      viewId={viewId}
      recordId={recordId}
      commentId={commentId}
      recordIds={recordIds}
      serverData={recordServerData}
      model={ExpandRecordModel.Modal}
      onClose={onClose}
      onUpdateRecordIdCallback={onUpdateRecordIdCallback}
    />
  );
});

ExpandRecordContainerBase.displayName = 'ExpandRecordContainerBase';
