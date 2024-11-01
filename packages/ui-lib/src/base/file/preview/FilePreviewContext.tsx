import { createContext } from 'react';

export interface IFileItemBase {
  name: string;
  src: string;
  mimetype: string;
  size?: number;
  thumb?: string;
  downloadUrl?: string;
}

export type IFileId = number | string;

export interface IFileItemInner extends IFileItemBase {
  fileId: IFileId;
}

export interface IFileItem extends IFileItemBase {
  fileId?: IFileId;
}

export const FilePreviewContext = createContext<{
  currentFile?: IFileItemInner;
  files: IFileItemInner[];
  mergeFiles: (fileItem: IFileItemInner) => void;
  resetFiles: (files?: IFileItemInner[]) => void;
  openPreview: (fileId?: IFileId) => void;
  closePreview: () => void;
  onPrev: () => void;
  onNext: () => void;
  onDelete: (fileId: IFileId) => void;
  i18nMap?: Record<string, string>;
}>(null!);
