import { create } from 'zustand';
import type { CombinedSelection } from '../../grid/managers';
import type { IHeaderMenu, IRecordMenu, IStatisticMenu } from './type';

interface IGridViewState {
  selection?: CombinedSelection;
  headerMenu?: IHeaderMenu;
  recordMenu?: IRecordMenu;
  statisticMenu?: IStatisticMenu;
  openHeaderMenu: (props: IHeaderMenu) => void;
  closeHeaderMenu: () => void;
  openRecordMenu: (props: IRecordMenu) => void;
  closeRecordMenu: () => void;
  openStatisticMenu: (props: IStatisticMenu) => void;
  closeStatisticMenu: () => void;
  setSelection: (props: CombinedSelection) => void;
}

export const useGridViewStore = create<IGridViewState>((set) => ({
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
  openStatisticMenu: (props) => {
    set((state) => {
      return {
        ...state,
        statisticMenu: props,
      };
    });
  },
  closeStatisticMenu: () => {
    set((state) => {
      if (state.statisticMenu == null) {
        return state;
      }
      return {
        ...state,
        statisticMenu: undefined,
      };
    });
  },
  setSelection: (props) => {
    set((state) => {
      return {
        ...state,
        selection: props,
      };
    });
  },
}));
