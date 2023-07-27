import { create } from 'zustand';
import type { IHeaderMenu, IRecordMenu, ISetting } from './type';

interface IGridViewState {
  setting?: ISetting;
  headerMenu?: IHeaderMenu;
  recordMenu?: IRecordMenu;
  openSetting: (props: ISetting) => void;
  closeSetting: () => void;
  openHeaderMenu: (props: IHeaderMenu) => void;
  closeHeaderMenu: () => void;
  openRecordMenu: (props: IRecordMenu) => void;
  closeRecordMenu: () => void;
}

export const useGridViewStore = create<IGridViewState>((set) => ({
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
  openHeaderMenu: (props) => {
    set((state) => {
      return {
        ...state,
        headerMenu: props,
      };
    });
  },
  closeHeaderMenu: () => {
    set((state) => {
      if (state.headerMenu == null) {
        return state;
      }
      return {
        ...state,
        headerMenu: undefined,
      };
    });
  },
  openRecordMenu: (props) => {
    set((state) => {
      return {
        ...state,
        recordMenu: props,
      };
    });
  },
  closeRecordMenu: () => {
    set((state) => {
      if (state.recordMenu == null) {
        return state;
      }
      return {
        ...state,
        recordMenu: undefined,
      };
    });
  },
}));
