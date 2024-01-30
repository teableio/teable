import type { IRecord } from '@teable/core';
import { useTableId } from '@teable/sdk/hooks';
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
  const recordId = router.query.recordId as string;

  const onClose = useCallback(() => {
    if (!router.asPath.includes(`/${recordId}`)) {
      return;
    }
    const url = router.asPath.replace(`/${recordId}`, '');
    router.push(url, undefined, {
      shallow: true,
    });
  }, [recordId, router]);

  const onUpdateRecordIdCallback = useCallback(
    (recordId: string) => {
      router.push(
        {
          pathname: `${router.pathname}/[recordId]`,
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
      recordServerData={recordServerData}
      onClose={onClose}
      onUpdateRecordIdCallback={onUpdateRecordIdCallback}
    />
  );
});

ExpandRecordContainer.displayName = 'ExpandRecordContainer';
