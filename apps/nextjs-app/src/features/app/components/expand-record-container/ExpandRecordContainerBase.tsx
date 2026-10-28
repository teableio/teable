import type { IAttachmentCellValue, IRecord } from '@teable/core';
import { BaseNodeResourceType } from '@teable/openapi';
import type { IButtonClickStatusHook } from '@teable/sdk';
import { ExpandRecorder, ExpandRecordModel } from '@teable/sdk';
import { useRouter } from 'next/router';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { parseBaseSlug } from '../../hooks/useBaseResource';
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
    onAttachmentDownload?: (attachments: IAttachmentCellValue) => void;
  }
>((props, forwardRef) => {
  const {
    tableId,
    viewId,
    recordServerData,
    onClose,
    onUpdateRecordIdCallback,
    buttonClickStatusHook,
    onAttachmentDownload,
  } = props;
  const router = useRouter();
  const {
    recordId: routerRecordId,
    commentId: routerCommentId,
    showHistory: routerShowHistory,
    showComment: routerShowComment,
  } = router.query;
  // A table shown off its route (a tab beside the one the URL names) leaves the URL's record to
  // the table the URL names, instead of opening it against its own records.
  const routeResource = parseBaseSlug(router.query.slug as string[] | undefined);
  const routeTableId =
    routeResource.resourceType === BaseNodeResourceType.Table ? routeResource.tableId : undefined;
  const ownsRecord = !routeTableId || routeTableId === tableId;
  const recordId = ownsRecord ? (routerRecordId as string) : undefined;
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
      onAttachmentDownload={onAttachmentDownload}
    />
  );
});

ExpandRecordContainerBase.displayName = 'ExpandRecordContainerBase';
