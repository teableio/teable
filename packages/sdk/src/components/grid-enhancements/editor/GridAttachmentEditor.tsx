import type { IAttachmentCellValue } from '@teable-group/core';
import type { IFilePreviewDialogRef } from '@teable-group/ui-lib';
import {
  Dialog,
  DialogContent,
  FilePreviewDialog,
  FilePreviewProvider,
} from '@teable-group/ui-lib';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { AttachmentEditorMain } from '../../editor';
import type { IEditorProps } from '../../grid/components';
import type { IWrapperEditorProps } from './type';

interface IGridAttachmentEditorRef {
  openFilePreview?: (activeId?: string) => void;
}

export const GridAttachmentEditor = forwardRef<
  IGridAttachmentEditorRef,
  IWrapperEditorProps & IEditorProps
>((props, ref) => {
  const { record, field, isEditing, setEditing } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const attachments = record.getCellValue(field.id) as IAttachmentCellValue;
  const imagePreviewDialogRef = useRef<IFilePreviewDialogRef>(null);

  const previewFiles = useMemo(() => {
    return attachments
      ? attachments.map((item) => ({
          src: item.url,
          name: item.name,
          fileId: item.id,
          mimetype: item.mimetype,
        }))
      : [];
  }, [attachments]);

  useImperativeHandle(ref, () => ({
    openFilePreview: (activeId?: string) => {
      imagePreviewDialogRef.current?.openPreview?.(activeId);
    },
    closeFilePreview: () => {
      imagePreviewDialogRef.current?.closePreview?.();
    },
  }));

  const setAttachments = (attachments?: IAttachmentCellValue) => {
    record.updateCell(field.id, attachments);
  };

  return (
    <>
      <div ref={containerRef} />
      <Dialog open={isEditing} onOpenChange={setEditing}>
        <DialogContent
          container={containerRef.current}
          className="click-outside-ignore h-90 flex-1 overflow-hidden"
        >
          <AttachmentEditorMain value={attachments || []} onChange={setAttachments} />
        </DialogContent>
      </Dialog>
      <FilePreviewProvider>
        <FilePreviewDialog ref={imagePreviewDialogRef} files={previewFiles} />
      </FilePreviewProvider>
    </>
  );
});

GridAttachmentEditor.displayName = 'GridAttachmentEditor';
