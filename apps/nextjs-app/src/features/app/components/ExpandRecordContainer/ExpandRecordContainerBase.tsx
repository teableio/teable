import type { IRecord } from '@teable/core';
import { ExpandRecorder, ExpandRecordModel } from '@teable/sdk';
import { useRouter } from 'next/router';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { useSelectionOperation } from '@/features/app/blocks/view/grid/hooks';
import { useGridViewStore } from '@/features/app/blocks/view/grid/store/gridView';
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
  const { deleteRecords } = useSelectionOperation();
  const { selection } = useGridViewStore();
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
      model={ExpandRecordModel.Modal}
      onClose={onClose}
      onUpdateRecordIdCallback={onUpdateRecordIdCallback}
      onDelete={async () => {
        if (selection) await deleteRecords(selection);
      }}
    />
  );
});

ExpandRecordContainerBase.displayName = 'ExpandRecordContainerBase';
