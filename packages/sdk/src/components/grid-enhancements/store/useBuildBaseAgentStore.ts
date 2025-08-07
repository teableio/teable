import { create } from 'zustand';

type IDisplayCellInfo = [number, string];

interface IBuildBaseStore {
  building: boolean;
  setBuilding: (building: boolean) => void;
  tableId: string | undefined;
  setTableId: (tableId: string) => void;
  displayRecord: IDisplayCellInfo[];
  setDisplayRecord: (displayRecord: IDisplayCellInfo[]) => void;

  displayTables: string[];
  setDisplayTables: (displayTables: string[]) => void;
  displayViews: string[];
  setDisplayViews: (displayViews: string[]) => void;
  displayFieldIds: string[];
  setDisplayFieldIds: (displayFieldIds: string[]) => void;
}

export const useBuildBaseAgentStore = create<IBuildBaseStore>()((set) => ({
  building: false,
  setBuilding: (building: boolean) => set({ building }),
  tableId: undefined,
  setTableId: (tableId: string) => set({ tableId }),
  displayRecord: [],
  setDisplayRecord: (displayRecord: IDisplayCellInfo[]) => set({ displayRecord }),

  displayTables: [],
  setDisplayTables: (displayTables: string[]) => set({ displayTables }),
  displayViews: [],
  setDisplayViews: (displayViews: string[]) => set({ displayViews }),
  displayFieldIds: [],
  setDisplayFieldIds: (displayFieldIds: string[]) => set({ displayFieldIds }),
}));
