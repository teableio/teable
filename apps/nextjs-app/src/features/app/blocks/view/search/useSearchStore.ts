import { create } from 'zustand';

interface ISearchState {
  fieldId?: string;
  value?: string;
  setFieldId: (fieldId: string) => void;
  setValue: (value: string) => void;
  reset: () => void;
}

export const useSearchStore = create<ISearchState>((set) => ({
  setFieldId: (fieldId: string) => {
    set((state) => {
      return {
        ...state,
        fieldId,
      };
    });
  },
  setValue: (value: string) => {
    set((state) => {
      return {
        ...state,
        value,
      };
    });
  },
  reset: () => {
    set((state) => ({
      ...state,
      fieldId: undefined,
      value: undefined,
    }));
  },
}));
