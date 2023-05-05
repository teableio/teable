import { create } from 'zustand';
import type { IFieldSetting } from './type';
import { FieldOperator } from './type';

const defaultConfig: IFieldSetting = {
  visible: false,
  operator: FieldOperator.Add,
};

interface IFieldSettingState {
  fieldSetting: Pick<IFieldSetting, 'field' | 'operator' | 'visible'>;
  open: (config: IFieldSetting) => void;
  close: () => void;
}

export const useFieldSettingStore = create<IFieldSettingState>((set) => ({
  fieldSetting: defaultConfig,
  open: (config: IFieldSetting) =>
    set((state) => {
      return {
        ...state,
        fieldSetting: { ...state.fieldSetting, ...config, visible: true },
      };
    }),
  close: () =>
    set((state) => {
      return {
        ...state,
        fieldSetting: defaultConfig,
      };
    }),
}));
