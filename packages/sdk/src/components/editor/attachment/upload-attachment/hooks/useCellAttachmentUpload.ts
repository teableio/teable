import { useCallback, useMemo } from 'react';
import {
  buildCellKey,
  useCellAttachmentUploadStore,
  type ICellUploadTask,
} from '../../../../../store/use-attachment-upload-store';
import type { IUploadingFile } from '../types';

interface UseCellAttachmentUploadParams {
  tableId: string;
  recordId: string;
  fieldId: string;
  baseId?: string;
  enabled: boolean;
}

interface UseCellAttachmentUploadReturn {
  uploadingFiles: IUploadingFile[];
  onUpload: (files: File[]) => void;
  onCancelUpload: (id: string) => void;
}

export const useCellAttachmentUpload = (
  params: UseCellAttachmentUploadParams
): UseCellAttachmentUploadReturn => {
  const { tableId, recordId, fieldId, baseId, enabled } = params;
  const startCellUpload = useCellAttachmentUploadStore((state) => state.startUpload);
  const cancelCellTask = useCellAttachmentUploadStore((state) => state.cancelTask);
  const cellKey = useMemo(
    () => buildCellKey(tableId, recordId, fieldId),
    [tableId, recordId, fieldId]
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

  const onUpload = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      if (!enabled) return;
      startCellUpload(tableId, recordId, fieldId, files, baseId);
    },
    [baseId, enabled, fieldId, recordId, startCellUpload, tableId]
  );

  const onCancelUpload = useCallback(
    (id: string) => {
      cancelCellTask(cellKey, id);
    },
    [cancelCellTask, cellKey]
  );

  return { uploadingFiles, onUpload, onCancelUpload };
};
