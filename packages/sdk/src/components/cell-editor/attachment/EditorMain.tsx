import type { IAttachmentCellValue } from '@teable-group/core';
import { noop } from 'lodash';
import { UploadAttachment } from './upload-attachment/UploadAttachment';

export const AttachmentEditorMain = (props: {
  value?: IAttachmentCellValue;
  onChange?: (value: IAttachmentCellValue) => void;
}) => {
  const { value, onChange = noop } = props;
  return <UploadAttachment attachments={value || []} onChange={onChange} />;
};
