import { create } from 'zustand';
import type { IEditorCtx, IHeaderMenu, ISetting } from './type';

interface IGridViewState {
  setting?: ISetting;
  headerMenu?: IHeaderMenu;
  editorCtx?: IEditorCtx;
  openSetting: (props: ISetting) => void;
  closeSetting: () => void;
  openHeaderMenu: (props: IHeaderMenu) => void;
  closeHeaderMenu: () => void;
  updateEditorPosition: (props: IEditorCtx) => void;
  clearEditorCtx: () => void;
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
      if (state.headerMenu == undefined) {
        return state;
      }
      return {
        ...state,
        headerMenu: undefined,
      };
    });
  },
  updateEditorPosition: (props) => {
    set((state) => {
      return {
        ...state,
        editorCtx: props,
      };
    });
  },
  clearEditorCtx: () => {
    set((state) => {
      if (state.editorCtx == undefined) {
        return state;
      }
      return {
        ...state,
        editorCtx: undefined,
      };
    });
  },
}));
