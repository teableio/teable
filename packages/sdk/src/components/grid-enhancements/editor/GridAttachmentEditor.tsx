import type { IAttachmentCellValue } from '@teable/core';
import type { IFilePreviewDialogRef } from '@teable/ui-lib';
import { cn, Dialog, DialogContent, FilePreviewDialog, FilePreviewProvider } from '@teable/ui-lib';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { AttachmentEditorMain } from '../../editor';
import type { IEditorProps } from '../../grid/components';
import { useAttachmentPreviewI18Map } from '../../hooks';
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
  const i18nMap = useAttachmentPreviewI18Map();
  const previewFiles = useMemo(() => {
    return attachments
      ? attachments.map((item) => ({
          src: item.presignedUrl || '',
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
          className={cn(
            'click-outside-ignore flex-1 overflow-hidden max-w-xl p-5 pt-8',
            Object.values(attachments || {}).length > 5 ? 'h-full max-h-[600px] mt-1 mb-1' : 'h-96'
          )}
        >
          <AttachmentEditorMain value={attachments || []} onChange={setAttachments} />
        </DialogContent>
      </Dialog>
      <FilePreviewProvider i18nMap={i18nMap}>
        <FilePreviewDialog ref={imagePreviewDialogRef} files={previewFiles} />
      </FilePreviewProvider>
    </>
  );
});

GridAttachmentEditor.displayName = 'GridAttachmentEditor';
