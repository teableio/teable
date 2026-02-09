import type { IAttachmentCellValue } from '@teable/core';
import type { AttachmentManager } from './uploadManage';

export type UploadAttachmentMode = 'local' | 'cell';

export interface IUploadingFile {
  id: string;
  file: File;
  progress: number;
}

export interface UploadAttachmentBaseProps {
  className?: string;
  attachments: IAttachmentCellValue;
  onChange?: (attachment: IAttachmentCellValue | null) => void;
  /** Show download all button, uses store to trigger download */
  showDownloadAll?: boolean;
  readonly?: boolean;
  disabled?: boolean;
}

export interface UploadAttachmentLocalProps extends UploadAttachmentBaseProps {
  mode: 'local';
  attachmentManager?: AttachmentManager;
}

export interface UploadAttachmentCellProps extends UploadAttachmentBaseProps {
  mode: 'cell';
  tableId: string;
  recordId: string;
  fieldId: string;
}

export type IUploadAttachment = UploadAttachmentLocalProps | UploadAttachmentCellProps;

export interface IUploadAttachmentRef {
  uploadAttachment: (files: File[]) => void;
  setUploadingFiles: (files: IUploadingFile[]) => void;
}

export interface UploadAttachmentViewProps extends UploadAttachmentBaseProps {
  uploadingFiles: IUploadingFile[];
  onUpload: (files: File[]) => void;
  onCancelUpload?: (id: string) => void;
}

export interface UploadAttachmentViewRef {
  scrollToBottom: () => void;
}
