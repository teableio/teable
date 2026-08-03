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
}

export const FilePreviewDialog = forwardRef<IFilePreviewDialogRef, IFilePreviewDialogProps>(
  (props, ref) => {
    const { files } = props;
    const filesRef = useRef<IFileItem[]>();
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

    const updateFiles = useCallback(
      (files: IFileItem[]) => {
        const innerFiles = files.map((item) => ({
          ...item,
          fileId: item?.fileId ?? genFileId(),
        }));
        resetFiles(innerFiles);
        // if current file is not in files
        const oldFileIndex = oldFiles.findIndex(({ fileId }) => fileId === currentFile?.fileId);
        if (oldFileIndex === -1) {
          closePreview();
          return;
        }
        const currentInNewExist = innerFiles.some(({ fileId }) => fileId === currentFile?.fileId);
        if (!currentInNewExist) {
          const existIndex =
            oldFileIndex > innerFiles.length - 1 ? innerFiles.length - 1 : oldFileIndex;
          openPreview(existIndex);
        }
      },
      [closePreview, currentFile?.fileId, oldFiles, openPreview, resetFiles]
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
