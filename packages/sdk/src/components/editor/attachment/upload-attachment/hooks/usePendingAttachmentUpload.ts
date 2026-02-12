import type { IAttachmentCellValue, IAttachmentItem } from '@teable/core';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  buildCellKey,
  useCellAttachmentUploadStore,
  type ICellUploadTask,
} from '../../../../../store/use-attachment-upload-store';
import type { IUploadingFile } from '../types';

interface UsePendingAttachmentUploadParams {
  tableId: string;
  tempRecordId: string;
  fieldId: string;
  baseId?: string;
  attachments: IAttachmentCellValue;
  onChange?: (attachment: IAttachmentCellValue | null) => void;
}

interface UsePendingAttachmentUploadReturn {
  uploadingFiles: IUploadingFile[];
  onUpload: (files: File[]) => void;
  onCancelUpload: (id: string) => void;
}

export const usePendingAttachmentUpload = (
  params: UsePendingAttachmentUploadParams
): UsePendingAttachmentUploadReturn => {
  const { tableId, tempRecordId, fieldId, baseId, attachments, onChange } = params;

  const startPendingUpload = useCellAttachmentUploadStore((state) => state.startPendingUpload);
  const cancelCellTask = useCellAttachmentUploadStore((state) => state.cancelTask);

  const cellKey = useMemo(
    () => buildCellKey(tableId, tempRecordId, fieldId),
    [tableId, tempRecordId, fieldId]
  );

  const emptyTasks = useMemo<ICellUploadTask[]>(() => [], []);
  const tasks = useCellAttachmentUploadStore(
    (state) => state.cellUploads[cellKey]?.tasks ?? emptyTasks
  );

  const uploadingFiles = useMemo(() => {
    return tasks
      .filter((task) => task.status !== 'completed')
      .map((task) => ({
        id: task.id,
        file: task.file,
        progress: task.progress,
      }));
  }, [tasks]);

  // Accumulates items completed by this hook but not yet reflected in parent's `attachments` prop.
  // This buffer is immune to parent re-render timing and prevents data loss when
  // multiple uploads complete in rapid succession.
  const localAdditionsRef = useRef<IAttachmentItem[]>([]);

  // When parent's attachments update (i.e. our onChange has propagated),
  // remove items from the local buffer that are now in the parent's value.
  useEffect(() => {
    if (localAdditionsRef.current.length === 0) return;
    const parentIds = new Set((attachments || []).map((a) => a.id));
    localAdditionsRef.current = localAdditionsRef.current.filter((a) => !parentIds.has(a.id));
  }, [attachments]);

  // When pending uploads complete, merge and notify parent
  useEffect(() => {
    const completedItems: { id: string; item: NonNullable<ICellUploadTask['attachmentItem']> }[] =
      [];

    tasks.forEach((task) => {
      if (task.status === 'completed' && task.attachmentItem) {
        completedItems.push({ id: task.id, item: task.attachmentItem });
      }
    });

    if (completedItems.length === 0 || !onChange) return;

    // Dedup against both parent attachments and our local additions buffer
    const existingIds = new Set([
      ...(attachments || []).map((a) => a.id),
      ...localAdditionsRef.current.map((a) => a.id),
    ]);
    const genuinelyNew = completedItems.filter((c) => !existingIds.has(c.item.id));

    if (genuinelyNew.length > 0) {
      const additions = genuinelyNew.map((c) => c.item);
      localAdditionsRef.current = [...localAdditionsRef.current, ...additions];
      // Full value = parent attachments + all buffered local additions
      onChange([...(attachments || []), ...localAdditionsRef.current]);
    }

    // Do not remove completed tasks here.
    // They must remain in the pending store until create flow consumes/promotes them,
    // otherwise late-completion tasks can be lost during createRecords flight.
  }, [tasks, attachments, onChange]);

  const onUpload = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      startPendingUpload(tableId, tempRecordId, fieldId, files, baseId);
    },
    [baseId, fieldId, startPendingUpload, tableId, tempRecordId]
  );

  const onCancelUpload = useCallback(
    (id: string) => {
      cancelCellTask(cellKey, id);
    },
    [cancelCellTask, cellKey]
  );

  return { uploadingFiles, onUpload, onCancelUpload };
};
