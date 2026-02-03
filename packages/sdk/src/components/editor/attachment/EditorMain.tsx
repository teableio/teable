import type { IAttachmentCellValue } from '@teable/core';
import { noop } from 'lodash';
import type { ICellEditor } from '../type';
import { UploadAttachment } from './upload-attachment/UploadAttachment';
type IAttachmentEditorMain = ICellEditor<IAttachmentCellValue> & {
  /**
   * Cell upload mode: When provided, uploads are managed by global store
   */
  tableId: string;
  recordId?: string;
  fieldId: string;
};

export const AttachmentEditorMain = (props: IAttachmentEditorMain) => {
  const { className, value, onChange = noop, readonly, tableId, recordId, fieldId } = props;
  if (!tableId || !recordId || !fieldId) {
    return (
      <UploadAttachment
        className={className}
        mode="local"
        attachments={value || []}
        onChange={onChange}
        readonly={readonly}
        showDownloadAll
      />
    );
  }
  return (
    <UploadAttachment
      className={className}
      mode="cell"
      attachments={value || []}
      onChange={onChange}
      readonly={readonly}
      showDownloadAll
      tableId={tableId}
      recordId={recordId}
      fieldId={fieldId}
    />
  );
};
