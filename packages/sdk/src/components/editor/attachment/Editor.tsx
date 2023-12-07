import type { IAttachmentCellValue } from '@teable-group/core';
import { noop } from 'lodash';
import type { ICellEditor } from '../type';
import { UploadAttachment } from './upload-attachment/UploadAttachment';

type IAttachmentEditor = ICellEditor<IAttachmentCellValue>;

export const AttachmentEditor = (props: IAttachmentEditor) => {
  const { value, onChange = noop, readonly } = props;
  return <UploadAttachment attachments={value || []} onChange={onChange} readonly={readonly} />;
};
