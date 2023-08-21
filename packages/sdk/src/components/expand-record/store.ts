import type { IRecord } from '@teable-group/core';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { IExpandRecordModel } from './type';

interface IExpandRecord {
  tableId: string;
  viewId?: string;
  recordId: string;
  recordIds?: string[];
  serverData?: IRecord;
  onClose?: () => void;
}

interface IExpandRecordState {
  model?: IExpandRecordModel;
  records: IExpandRecord[];
  showActivity?: boolean;
  updateModel: (model?: IExpandRecordModel) => void;
  getRecordById: (recordId: string) => IExpandRecord | undefined;
  addExpandRecord: (record: IExpandRecord) => { existed: boolean };
  updateExpandRecord: (tableId: string, recordId: string, record: Partial<IExpandRecord>) => void;
  removeExpandRecord: (tableId?: string, recordId?: string) => void;
  updateShowActivity: (showActivity?: boolean) => void;
}

export const useExpandRecord = create<IExpandRecordState>()(
  persist(
    (set, get) => ({
      records: [],

      updateModel: (model) => {
        set((state) => ({ ...state, model }));
      },
      getRecordById: (recordId) => {
        return get().records.find((v) => v.recordId === recordId);
      },
      addExpandRecord: (record) => {
        let existed = false;
        set((state) => {
          existed =
            state.records.findIndex(
              ({ tableId, recordId }) => recordId === record.recordId && tableId === record.tableId
            ) > -1;
          if (existed) {
            return state;
          }
          return { ...state, records: state.records.concat(record) };
        });
        return { existed };
      },
      updateExpandRecord: (tableId, recordId, record) => {
        set((state) => {
          const records = state.records.map((r) => {
            if (r.tableId === tableId && r.recordId === recordId) {
              return { ...r, ...record };
            }
            return r;
          });
          return { ...state, records };
        });
      },
      removeExpandRecord: (tableId, recordId) => {
        set((state) => {
          if (tableId || recordId) {
            return {
              ...state,
              records: state.records.filter(
                (r) => (tableId && r.tableId !== tableId) || (recordId && r.recordId !== recordId)
              ),
            };
          }
          return { ...state, records: [] };
        });
      },
      updateShowActivity: (showActivity) => {
        set((state) => ({ ...state, showActivity }));
      },
    }),
    {
      name: 'expandRecord',
      partialize: (data) => ({ model: data.model, showActivity: data.showActivity }),
    }
  )
);
