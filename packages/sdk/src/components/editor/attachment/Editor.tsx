import type { IAttachmentCellValue } from '@teable/core';
import { noop } from 'lodash';
import type { ICellEditor } from '../type';
import { UploadAttachment } from './upload-attachment/UploadAttachment';

type IAttachmentEditor = ICellEditor<IAttachmentCellValue>;

export const AttachmentEditor = (props: IAttachmentEditor) => {
  const { className, value, onChange = noop, readonly } = props;
  return (
    <UploadAttachment
      className={className}
      attachments={value || []}
      onChange={onChange}
      readonly={readonly}
    />
  );
};
