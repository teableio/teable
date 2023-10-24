import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const FORM_MODE_LOCAL_STORAGE_KEY = '__t-form-mode';

export enum FormMode {
  Edit = 'Edit',
  Fill = 'Fill',
}

interface IFormModeState {
  modeMap: Record<string, FormMode>;
  setModeMap: (key: string, mode: FormMode) => void;
}

export const useFormModeStore = create<IFormModeState>()(
  persist(
    (set, get) => ({
      modeMap: {},
      setModeMap: (key: string, mode: FormMode) => {
        set({
          modeMap: {
            ...get().modeMap,
            [key]: mode,
          },
        });
      },
    }),
    {
      name: FORM_MODE_LOCAL_STORAGE_KEY,
    }
  )
);
