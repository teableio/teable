import type { IAttachmentCellValue } from '@teable-group/core';
import { Modal } from 'antd';
import { useState } from 'react';
import { UploadAttachment } from '@/features/app/components/upload-attachment/UploadAttachment';
import type { IEditorProps } from './type';

export const AttachmentEditor = (props: IEditorProps) => {
  const { record, field, onCancel } = props;
  const [open, setOpen] = useState(true);
  const attachments = record.getCellValue(field.id) as IAttachmentCellValue;
  const setAttachments = (attachments: IAttachmentCellValue) => {
    record.updateCell(field.id, attachments);
  };

  const afterOpenChange = (open: boolean) => {
    if (!open) {
      onCancel?.();
    }
  };

  return (
    <Modal
      open={open}
      onCancel={() => setOpen(false)}
      footer={false}
      afterOpenChange={afterOpenChange}
      centered
      destroyOnClose
    >
      <div className="h-80 flex-1 overflow-hidden">
        <UploadAttachment attachments={attachments || []} onChange={setAttachments} />
      </div>
    </Modal>
  );
};
