import type { IAttachmentCellValue } from '@teable/core';
import { noop } from 'lodash';
import type { ICellEditor } from '../type';
import { UploadAttachment } from './upload-attachment/UploadAttachment';
import type { AttachmentManager } from './upload-attachment/uploadManage';

type IAttachmentEditorMain = ICellEditor<IAttachmentCellValue>;

export const AttachmentEditorMain = (
  props: IAttachmentEditorMain & { attachmentManager?: AttachmentManager }
) => {
  const { className, value, onChange = noop, readonly, attachmentManager } = props;
  return (
    <UploadAttachment
      className={className}
      attachments={value || []}
      onChange={onChange}
      readonly={readonly}
      attachmentManager={attachmentManager}
    />
  );
};
