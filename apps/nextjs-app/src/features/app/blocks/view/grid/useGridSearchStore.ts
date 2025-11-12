import type { IGridRef, IRecordIndexMap, IFieldInstance } from '@teable/sdk';
import { noop } from 'lodash';
import { create } from 'zustand';

// Event emitter for recordMap changes
type RecordMapListener = (recordMap: IRecordIndexMap | null) => void;
const recordMapListeners = new Set<RecordMapListener>();

export const subscribeToRecordMap = (listener: RecordMapListener) => {
  recordMapListeners.add(listener);
  return () => recordMapListeners.delete(listener);
};

const notifyRecordMapChange = (recordMap: IRecordIndexMap | null) => {
  recordMapListeners.forEach((listener) => listener(recordMap));
};

// Event emitter for fields changes
type FieldsListener = (fields: IFieldInstance[] | null) => void;
const fieldsListeners = new Set<FieldsListener>();

export const subscribeToFields = (listener: FieldsListener) => {
  fieldsListeners.add(listener);
  return () => fieldsListeners.delete(listener);
};

const notifyFieldsChange = (fields: IFieldInstance[] | null) => {
  fieldsListeners.forEach((listener) => listener(fields));
};

interface IGridRefState {
  gridRef: React.RefObject<IGridRef> | null;
  setGridRef: (ref: React.RefObject<IGridRef>) => void;
  searchCursor: [number, number] | null;
  setSearchCursor: (cell: [number, number] | null) => void;
  resetSearchHandler: () => void;
  setResetSearchHandler: (fn: () => void) => void;
  recordMap: IRecordIndexMap | null;
  setRecordMap: (recordMap: IRecordIndexMap | null) => void;
  fields: IFieldInstance[] | null;
  setFields: (fields: IFieldInstance[] | null) => void;
  highlightedTableId: string | null;
  setHighlightedTableId: (tableId: string | null) => void;
  highlightedViewId: string | null;
  setHighlightedViewId: (viewId: string | null) => void;
}

export const useGridSearchStore = create<IGridRefState>((set) => ({
  gridRef: null,
  searchCursor: null,
  recordMap: null,
  fields: null,
  highlightedTableId: null,
  highlightedViewId: null,
  resetSearchHandler: noop,
  setResetSearchHandler: (fn: () => void) => {
    set((state) => {
      return {
        ...state,
        resetSearchHandler: fn,
      };
    });
  },
  setGridRef: (ref: React.RefObject<IGridRef>) => {
    set((state) => {
      return {
        ...state,
        gridRef: ref,
      };
    });
  },
  setSearchCursor: (cell: [number, number] | null) => {
    set((state) => {
      return {
        ...state,
        searchCursor: cell,
      };
    });
  },
  setRecordMap: (recordMap: IRecordIndexMap | null) => {
    set((state) => {
      // Notify listeners when recordMap changes
      notifyRecordMapChange(recordMap);
      return {
        ...state,
        recordMap: recordMap,
      };
    });
  },
  setFields: (fields: IFieldInstance[] | null) => {
    set((state) => {
      // Notify listeners when fields change
      notifyFieldsChange(fields);
      return {
        ...state,
        fields: fields,
      };
    });
  },
  setHighlightedTableId: (tableId: string | null) => {
    set((state) => {
      return {
        ...state,
        highlightedTableId: tableId,
      };
    });
  },
  setHighlightedViewId: (viewId: string | null) => {
    set((state) => {
      return {
        ...state,
        highlightedViewId: viewId,
      };
    });
  },
}));
