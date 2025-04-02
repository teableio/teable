import type { IRecord } from '@teable/core';
import { useTableId, useViewId } from '@teable/sdk/hooks';
import { useRouter } from 'next/router';
import { forwardRef, useCallback } from 'react';
import { ExpandRecordContainerBase } from './ExpandRecordContainerBase';
import type { IExpandRecordContainerRef } from './types';

export const ExpandRecordContainer = forwardRef<
  IExpandRecordContainerRef,
  { recordServerData?: IRecord }
>((props, forwardRef) => {
  const { recordServerData } = props;
  const router = useRouter();
  const tableId = useTableId();
  const viewId = useViewId();
  const recordId = router.query.recordId as string;

  const onClose = useCallback(() => {
    if (!recordId) {
      return;
    }
    const {
      recordId: _recordId,
      fromNotify: _fromNotify,
      commentId: _commentId,
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
    />
  );
});

ExpandRecordContainer.displayName = 'ExpandRecordContainer';
