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
  const { children, className, style, onBeforeOpen, onDelete, onCopyLink, ...fileItem } = props;
  const { openPreview, mergeFiles, removeFile } = useContext(FilePreviewContext);

  const fileIdRef = useRef<number>(genFileId());
  const oldFileItemRef = useRef<IFileItem>(undefined);
  const onDeleteRef = useRef(onDelete);
  const hasDelete = Boolean(onDelete);
  const onCopyLinkRef = useRef(onCopyLink);
  const hasCopyLink = Boolean(onCopyLink);

  useEffect(() => {
    onDeleteRef.current = onDelete;
    onCopyLinkRef.current = onCopyLink;
  }, [onDelete, onCopyLink]);

  // Stable wrappers: the registered item must not churn when the host re-creates its callbacks.
  const deleteFile = useCallback(() => onDeleteRef.current?.(), []);
  const copyLink = useCallback(() => onCopyLinkRef.current?.(), []);

  useEffect(() => {
    const fileId = fileIdRef.current;
    const isItemChange = fileItem !== oldFileItemRef.current;
    if (isItemChange) {
      oldFileItemRef.current = fileItem;
      mergeFiles({
        ...fileItem,
        fileId,
        onDelete: hasDelete ? deleteFile : undefined,
        onCopyLink: hasCopyLink ? copyLink : undefined,
      });
    }
  }, [fileItem, mergeFiles, hasDelete, deleteFile, hasCopyLink, copyLink]);

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
