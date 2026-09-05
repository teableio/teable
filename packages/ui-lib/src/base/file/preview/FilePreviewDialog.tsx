import { forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useRef } from 'react';
import type { IFileId, IFileItem } from './FilePreviewContext';
import { FilePreviewContext } from './FilePreviewContext';
import { genFileId } from './genFileId';

export interface IFilePreviewDialogRef {
  openPreview: (activeId?: IFileId) => void;
  closePreview: () => void;
}

interface IFilePreviewDialogProps {
  files: IFileItem[];
  /** Deletes the file with the given id. The preview shows a delete action only when provided. */
  onDelete?: (fileId: IFileId) => void;
}

export const FilePreviewDialog = forwardRef<IFilePreviewDialogRef, IFilePreviewDialogProps>(
  (props, ref) => {
    const { files, onDelete } = props;
    const filesRef = useRef<IFileItem[]>();
    const onDeleteRef = useRef(onDelete);
    const hasDelete = Boolean(onDelete);
    const {
      currentFile,
      files: oldFiles,
      openPreview,
      closePreview,
      resetFiles,
    } = useContext(FilePreviewContext);
    useImperativeHandle(ref, () => ({
      openPreview: (activeId?: number | string) => {
        openPreview(activeId);
      },
      closePreview: () => {
        closePreview();
      },
    }));

    useEffect(() => {
      onDeleteRef.current = onDelete;
    }, [onDelete]);

    const updateFiles = useCallback(
      (files: IFileItem[]) => {
        const innerFiles = files.map((item) => {
          const fileId = item?.fileId ?? genFileId();
          return {
            ...item,
            fileId,
            onDelete: hasDelete ? () => onDeleteRef.current?.(fileId) : item.onDelete,
          };
        });
        resetFiles(innerFiles);
        // if current file is not in files
        const oldFileIndex = oldFiles.findIndex(({ fileId }) => fileId === currentFile?.fileId);
        if (oldFileIndex === -1) {
          closePreview();
          return;
        }
        const currentInNewExist = innerFiles.some(({ fileId }) => fileId === currentFile?.fileId);
        if (!currentInNewExist) {
          // Move to the file that took the removed slot, falling back to the new
          // last file. With nothing left the preview closes.
          const fallback = innerFiles[Math.min(oldFileIndex, innerFiles.length - 1)];
          fallback ? openPreview(fallback.fileId) : closePreview();
        }
      },
      [closePreview, currentFile?.fileId, hasDelete, oldFiles, openPreview, resetFiles]
    );

    useEffect(() => {
      if (files !== filesRef.current) {
        filesRef.current = files;
        updateFiles(files);
      }
    }, [files, updateFiles]);
    return null;
  }
);

FilePreviewDialog.displayName = 'FilePreviewDialog';
