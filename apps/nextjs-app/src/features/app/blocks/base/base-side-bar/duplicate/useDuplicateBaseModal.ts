import type { IGetBaseVo } from '@teable/openapi';
import { create } from 'zustand';

interface IDuplicateBaseState {
  base?: IGetBaseVo;
  closeModal: () => void;
  openModal: (base: IGetBaseVo) => void;
}

export const useDuplicateBaseStore = create<IDuplicateBaseState>((set) => ({
  closeModal: () => {
    set((state) => {
      return {
        ...state,
        base: undefined,
      };
    });
  },
  openModal: (base: IGetBaseVo) => {
    set((state) => {
      return {
        ...state,
        base,
      };
    });
  },
}));
