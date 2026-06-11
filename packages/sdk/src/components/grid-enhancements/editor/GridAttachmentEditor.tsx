/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import type { IAttachmentCellValue } from '@teable/core';
import type { IFilePreviewDialogRef } from '@teable/ui-lib';
import { cn, FilePreviewDialog, FilePreviewProvider } from '@teable/ui-lib';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { AttachmentEditorMain } from '../../editor';
import type { IEditorProps } from '../../grid/components';
import { useAttachmentPreviewI18Map } from '../../hooks';
import { useGridPopupPosition } from '../hooks';
import type { IWrapperEditorProps } from './type';

interface IGridAttachmentEditorRef {
  openFilePreview?: (activeId?: string) => void;
}

export const GridAttachmentEditor = forwardRef<
  IGridAttachmentEditorRef,
  IWrapperEditorProps & IEditorProps
>((props, ref) => {
  const { record, field, style, rect, isEditing, setEditing } = props;
  const attachStyle = useGridPopupPosition(rect, 340);
  const containerRef = useRef<HTMLDivElement>(null);
  const attachments = record.getCellValue(field.id) as IAttachmentCellValue;
  const imagePreviewDialogRef = useRef<IFilePreviewDialogRef>(null);
  const i18nMap = useAttachmentPreviewI18Map();
  const { t } = useTranslation();

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
    record.updateCell(field.id, attachments, { t });
  };

  if (!isEditing) {
    return null;
  }
  return (
    <>
      <div
        ref={containerRef}
        style={{
          ...style,
          ...attachStyle,
          maxHeight: '320px',
        }}
        className={cn(
          'click-outside-ignore cursor-default flex flex-col absolute w-full overflow-hidden rounded-md border border-border-high bg-popover shadow-md dark:shadow-lg'
        )}
      >
        <div className="fixed inset-0 cursor-default" onClick={() => setEditing?.(false)} />
        <AttachmentEditorMain
          className="relative flex-1 overflow-hidden"
          value={attachments || []}
          onChange={setAttachments}
          tableId={field.tableId}
          recordId={record.id}
          fieldId={field.id}
        />
        <FilePreviewProvider i18nMap={i18nMap}>
          <FilePreviewDialog ref={imagePreviewDialogRef} files={previewFiles} />
        </FilePreviewProvider>
      </div>
    </>
  );
});

GridAttachmentEditor.displayName = 'GridAttachmentEditor';
