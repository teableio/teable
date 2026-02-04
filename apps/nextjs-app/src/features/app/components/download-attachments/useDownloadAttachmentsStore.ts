import type { IGetRecordsRo } from '@teable/openapi';
// Re-export cell download store from SDK for convenience
export { useDownloadAttachmentsStore } from '@teable/sdk';
import { create } from 'zustand';

// Column download dialog state - app-specific
interface IColumnDownloadDialogState {
  open: boolean;
  tableId?: string;
  fieldId?: string;
  fieldName?: string;
  viewId?: string;
  shareId?: string;
  personalViewCommonQuery?: IGetRecordsRo;

  openDialog: (params: {
    tableId: string;
    fieldId: string;
    fieldName: string;
    viewId?: string;
    shareId?: string;
    personalViewCommonQuery?: IGetRecordsRo;
  }) => void;
  closeDialog: () => void;
}

export const useColumnDownloadDialogStore = create<IColumnDownloadDialogState>((set) => ({
  open: false,

  openDialog: (params) =>
    set({
      open: true,
      ...params,
    }),
  closeDialog: () =>
    set({
      open: false,
      tableId: undefined,
      fieldId: undefined,
      fieldName: undefined,
      viewId: undefined,
      shareId: undefined,
      personalViewCommonQuery: undefined,
    }),
}));
