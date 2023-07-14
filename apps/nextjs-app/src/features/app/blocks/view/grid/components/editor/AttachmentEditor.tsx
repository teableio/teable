import type { IAttachmentCellValue } from '@teable-group/core';
import { AttachmentEditorMain } from '@teable-group/sdk';
import { Dialog, DialogContent } from '@teable-group/ui-lib/shadcn/ui/dialog';
import { useEffect, useRef, useState } from 'react';
import type { IEditorProps } from './type';

export const AttachmentEditor = (props: IEditorProps) => {
  const { record, field, onCancel } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);
  const attachments = record.getCellValue(field.id) as IAttachmentCellValue;
  const setAttachments = (attachments: IAttachmentCellValue) => {
    record.updateCell(field.id, attachments);
  };

  useEffect(() => {
    if (!open) {
      onCancel?.();
    }
  }, [onCancel, open]);

  return (
    <>
      <div ref={containerRef} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          container={containerRef.current}
          className="click-outside-ignore h-80 flex-1 overflow-hidden"
        >
          <AttachmentEditorMain value={attachments || []} onChange={setAttachments} />
        </DialogContent>
      </Dialog>
    </>
  );
};
