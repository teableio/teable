import type { IAttachmentCellValue } from '@teable/core';
import { create } from 'zustand';

export interface IDownloadProgress {
  downloaded: number;
  total: number;
  currentFileName: string;
  percent: number;
}

// Cell download signal state
interface ICellDownloadState {
  attachments?: IAttachmentCellValue;
  zipFileName?: string;
}

interface IDownloadAttachmentsState {
  // Cell download state
  cellDownload: ICellDownloadState;

  // Cell download actions
  triggerCellDownload: (attachments: IAttachmentCellValue, zipFileName?: string) => void;
  clearCellDownload: () => void;
}

export const useDownloadAttachmentsStore = create<IDownloadAttachmentsState>((set) => ({
  // Cell download state
  cellDownload: {},

  // Cell download actions
  triggerCellDownload: (attachments, zipFileName) =>
    set({
      cellDownload: { attachments, zipFileName },
    }),
  clearCellDownload: () =>
    set({
      cellDownload: {},
    }),
}));
