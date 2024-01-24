import { create } from 'zustand';
import type { FieldOperator } from '@/features/app/components/field-setting';

export interface IFieldSetting {
  operator: FieldOperator;
  fieldId?: string;
  order?: number;
}

interface IGridViewState {
  setting?: IFieldSetting;
  openSetting: (props: IFieldSetting) => void;
  closeSetting: () => void;
}

export const useFieldSettingStore = create<IGridViewState>((set) => ({
  openSetting: (props) => {
    set((state) => {
      return {
        ...state,
        setting: props,
      };
    });
  },
  closeSetting: () => {
    set((state) => {
      if (state.setting == undefined) {
        return state;
      }
      return {
        ...state,
        setting: undefined,
      };
    });
  },
}));
