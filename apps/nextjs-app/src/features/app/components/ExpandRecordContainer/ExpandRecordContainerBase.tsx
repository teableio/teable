import type { IRecord } from '@teable-group/core';
import { ExpandRecorder, IExpandRecordModel } from '@teable-group/sdk';
import { useRouter } from 'next/router';
import { forwardRef, useImperativeHandle, useState } from 'react';
import type { IExpandRecordContainerRef } from './types';

export const ExpandRecordContainerBase = forwardRef<
  IExpandRecordContainerRef,
  {
    tableId: string;
    recordServerData?: IRecord;
    onClose?: () => void;
    onUpdateRecordIdCallback?: (recordId: string) => void;
  }
>((props, forwardRef) => {
  const { tableId, recordServerData, onClose, onUpdateRecordIdCallback } = props;
  const router = useRouter();
  const recordId = router.query.recordId as string;
  const [recordIds, setRecordIds] = useState<string[]>();

  useImperativeHandle(forwardRef, () => ({
    updateRecordIds: setRecordIds,
  }));

  return (
    <ExpandRecorder
      tableId={tableId}
      recordId={recordId}
      recordIds={recordIds}
      serverData={recordServerData}
      model={IExpandRecordModel.Modal}
      onClose={onClose}
      onUpdateRecordIdCallback={onUpdateRecordIdCallback}
    />
  );
});

ExpandRecordContainerBase.displayName = 'ExpandRecordContainerBase';
