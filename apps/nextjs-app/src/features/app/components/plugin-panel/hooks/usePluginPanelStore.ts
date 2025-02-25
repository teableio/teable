import { LocalStorageKeys } from '@teable/sdk/config';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ITableState {
  isVisible: boolean;
  width: string;
  lastAccessed: number;
  activePanel?: string;
}

interface IPluginPanelState {
  tables: Record<string, ITableState>;
  toggleVisible: (tableId: string) => void;
  updateWidth: (tableId: string, width: string) => void;
  touchActivePanel: (tableId: string, panelId: string) => void;
}

export const DEFAULT_PLUGIN_PANEL_WIDTH = '25%';
const MAX_TABLES = 30;

const createDefaultState = (): ITableState => ({
  isVisible: false,
  width: DEFAULT_PLUGIN_PANEL_WIDTH,
  lastAccessed: Date.now(),
});

const checkAndCleanTables = (tables: Record<string, ITableState>, tableId: string) => {
  if (!tables[tableId]) {
    const tableIds = Object.entries(tables);
    if (tableIds.length >= MAX_TABLES) {
      const oldestId = tableIds.sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed)[0][0];
      delete tables[oldestId];
    }
  }
  return tables;
};

export const usePluginPanelStore = create<IPluginPanelState>()(
  persist(
    (set) => ({
      tables: {},
      toggleVisible: (tableId: string) =>
        set((state) => {
          const tables = checkAndCleanTables({ ...state.tables }, tableId);
          return {
            tables: {
              ...tables,
              [tableId]: {
                ...(tables[tableId] || createDefaultState()),
                isVisible: !tables[tableId]?.isVisible,
                lastAccessed: Date.now(),
              },
            },
          };
        }),

      updateWidth: (tableId: string, width: string) =>
        set((state) => {
          const tables = checkAndCleanTables({ ...state.tables }, tableId);
          return {
            tables: {
              ...tables,
              [tableId]: {
                ...(tables[tableId] || createDefaultState()),
                width,
                lastAccessed: Date.now(),
              },
            },
          };
        }),

      touchActivePanel: (tableId: string, panelId: string) =>
        set((state) => {
          const tables = checkAndCleanTables({ ...state.tables }, tableId);
          return {
            tables: {
              ...tables,
              [tableId]: {
                ...(tables[tableId] || createDefaultState()),
                lastAccessed: Date.now(),
                activePanel: panelId,
              },
            },
          };
        }),
    }),
    {
      name: LocalStorageKeys.PluginPanel,
      partialize: (state) => ({
        tables: state.tables,
      }),
    }
  )
);
