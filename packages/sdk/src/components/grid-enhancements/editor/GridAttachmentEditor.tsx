import type { IAttachmentCellValue } from '@teable-group/core';
import { Dialog, DialogContent } from '@teable-group/ui-lib';
import { useRef } from 'react';
import { AttachmentEditorMain } from '../../editor';
import type { IEditorProps } from '../../grid/components';
import type { IWrapperEditorProps } from './type';

export const GridAttachmentEditor = (props: IWrapperEditorProps & IEditorProps) => {
  const { record, field, isEditing, setEditing } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const attachments = record.getCellValue(field.id) as IAttachmentCellValue;
  const setAttachments = (attachments?: IAttachmentCellValue) => {
    record.updateCell(field.id, attachments);
  };

  return (
    <>
      <div ref={containerRef} />
      <Dialog open={isEditing} onOpenChange={setEditing}>
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
