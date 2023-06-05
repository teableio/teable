import { create } from 'zustand';
import type { ICell } from './type';

interface IViewState {
  activeCell?: ICell;
  editingCell?: ICell;
  selection?: [string[], string[]];
  activateCell: (cell: ICell) => void;
}

export const useViewStore = create<IViewState>((set) => ({
  activateCell: (cell: ICell) =>
    set((state) => {
      return {
        ...state,
        activeCell: cell,
      };
    }),
  setCellEditMode: (cell: ICell) =>
    set((state) => {
      return {
        ...state,
        editingCell: cell,
      };
    }),
}));
