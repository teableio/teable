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
  namingFieldId?: string;
  groupByRow: boolean;

  openDialog: (params: {
    tableId: string;
    fieldId: string;
    fieldName: string;
    viewId?: string;
    shareId?: string;
    personalViewCommonQuery?: IGetRecordsRo;
  }) => void;
  closeDialog: () => void;
  setNamingFieldId: (namingFieldId?: string) => void;
  setGroupByRow: (groupByRow: boolean) => void;
}

export const useColumnDownloadDialogStore = create<IColumnDownloadDialogState>((set) => ({
  open: false,
  groupByRow: false,

  openDialog: (params) =>
    set({
      open: true,
      namingFieldId: undefined, // Reset naming field when opening dialog
      groupByRow: false, // Reset group by row when opening dialog
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
      namingFieldId: undefined,
      groupByRow: false,
    }),
  setNamingFieldId: (namingFieldId) => set({ namingFieldId }),
  setGroupByRow: (groupByRow) => set({ groupByRow }),
}));
