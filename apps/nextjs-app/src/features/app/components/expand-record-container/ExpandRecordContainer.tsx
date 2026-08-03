import type { IAttachmentCellValue, IRecord } from '@teable/core';
import type { IButtonClickStatusHook } from '@teable/sdk/hooks';
import { useTableId, useViewId } from '@teable/sdk/hooks';
import { useRouter } from 'next/router';
import { forwardRef, useCallback } from 'react';
import { useDownloadAttachmentsStore } from '../download-attachments';
import { ExpandRecordContainerBase } from './ExpandRecordContainerBase';
import type { IExpandRecordContainerRef } from './types';

export const ExpandRecordContainer = forwardRef<
  IExpandRecordContainerRef,
  { recordServerData?: IRecord; buttonClickStatusHook?: IButtonClickStatusHook }
>((props, forwardRef) => {
  const { recordServerData, buttonClickStatusHook } = props;
  const router = useRouter();
  const tableId = useTableId();
  const viewId = useViewId();
  const recordId = router.query.recordId as string;
  const triggerCellDownload = useDownloadAttachmentsStore((state) => state.triggerCellDownload);

  const onClose = useCallback(() => {
    if (!recordId) {
      return;
    }
    const {
      recordId: _recordId,
      fromNotify: _fromNotify,
      commentId: _commentId,
      showHistory: _showHistory,
      showComment: _showComment,
      ...resetQuery
    } = router.query;
    router.push(
      {
        pathname: router.pathname,
        query: resetQuery,
      },
      undefined,
      {
        shallow: true,
      }
    );
  }, [recordId, router]);

  const onUpdateRecordIdCallback = useCallback(
    (recordId: string) => {
      router.push(
        {
          pathname: router.pathname,
          query: { ...router.query, recordId },
        },
        undefined,
        {
          shallow: true,
        }
      );
    },
    [router]
  );

  const onAttachmentDownload = useCallback(
    (attachments: IAttachmentCellValue) => {
      triggerCellDownload(attachments);
    },
    [triggerCellDownload]
  );

  if (!tableId) {
    return <></>;
  }

  return (
    <ExpandRecordContainerBase
      ref={forwardRef}
      tableId={tableId}
      viewId={viewId}
      recordServerData={recordServerData}
      onClose={onClose}
      onUpdateRecordIdCallback={onUpdateRecordIdCallback}
      buttonClickStatusHook={buttonClickStatusHook}
      onAttachmentDownload={onAttachmentDownload}
    />
  );
});

ExpandRecordContainer.displayName = 'ExpandRecordContainer';
