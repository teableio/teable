import type { IRecord } from '@teable/core';
import type { IButtonClickStatusHook } from '@teable/sdk';
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
    buttonClickStatusHook?: IButtonClickStatusHook;
  }
>((props, forwardRef) => {
  const {
    tableId,
    viewId,
    recordServerData,
    onClose,
    onUpdateRecordIdCallback,
    buttonClickStatusHook,
  } = props;
  const router = useRouter();
  const {
    recordId: routerRecordId,
    commentId: routerCommentId,
    showHistory: routerShowHistory,
    showComment: routerShowComment,
  } = router.query;
  const recordId = routerRecordId as string;
  const commentId = routerCommentId as string;
  const showHistory = routerShowHistory === 'true';
  const showComment = { true: true, false: false }[routerShowComment as string];

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
      buttonClickStatusHook={buttonClickStatusHook}
      showHistory={showHistory}
      showComment={showComment}
    />
  );
});

ExpandRecordContainerBase.displayName = 'ExpandRecordContainerBase';
