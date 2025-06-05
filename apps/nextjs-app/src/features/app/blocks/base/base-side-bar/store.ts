import { create } from 'zustand';

export interface IBaseSideBarStore {
  moveBaseOpen: boolean;
  setMoveBaseOpen: (open: boolean) => void;
  selectTableId: string | null;
  setSelectTableId: (tableId: string) => void;
}

export const useBaseSideBarStore = create<IBaseSideBarStore>()((set, get) => ({
  moveBaseOpen: false,
  selectTableId: null,
  setMoveBaseOpen: (visible: boolean) => {
    set({
      ...get(),
      moveBaseOpen: visible,
    });
  },
  setSelectTableId: (tableId: string | null) => {
    set({
      ...get(),
      selectTableId: tableId,
    });
  },
}));
