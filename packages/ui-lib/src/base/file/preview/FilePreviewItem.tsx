import type { CSSProperties } from 'react';
import { useCallback, useContext, useEffect, useRef } from 'react';
import { cn } from '../../../shadcn';
import { FilePreviewContext, type IFileItem } from './FilePreviewContext';
import { genFileId } from './genFileId';

interface IFilePreviewItem extends IFileItem {
  className?: string;
  style?: CSSProperties;
  children: React.ReactNode;
  onBeforeOpen?: () => void;
}

export const FilePreviewItem = (props: IFilePreviewItem) => {
  const { children, className, style, onBeforeOpen, onDelete, ...fileItem } = props;
  const { openPreview, mergeFiles, removeFile } = useContext(FilePreviewContext);

  const fileIdRef = useRef<number>(genFileId());
  const oldFileItemRef = useRef<IFileItem>();
  const onDeleteRef = useRef(onDelete);
  const hasDelete = Boolean(onDelete);

  useEffect(() => {
    onDeleteRef.current = onDelete;
  }, [onDelete]);

  // Stable wrapper: the registered item must not churn when the host re-creates its callback.
  const deleteFile = useCallback(() => onDeleteRef.current?.(), []);

  useEffect(() => {
    const fileId = fileIdRef.current;
    const isItemChange = fileItem !== oldFileItemRef.current;
    if (isItemChange) {
      oldFileItemRef.current = fileItem;
      mergeFiles({ ...fileItem, fileId, onDelete: hasDelete ? deleteFile : undefined });
    }
  }, [fileItem, mergeFiles, hasDelete, deleteFile]);

  useEffect(() => {
    const fileId = fileIdRef.current;
    return () => {
      fileId && removeFile(fileId);
    };
  }, [removeFile]);

  return (
    <div
      className={cn('size-full', className)}
      style={style}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onBeforeOpen?.();
          openPreview(fileIdRef.current);
          e.stopPropagation();
          e.preventDefault();
        }
      }}
      onClick={(e) => {
        e.stopPropagation();
        onBeforeOpen?.();
        openPreview(fileIdRef.current);
      }}
    >
      {children}
    </div>
  );
};
