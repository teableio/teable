import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LocalStorageKeys } from '../../../config';

interface IPersonalViewState {
  personalViewMap: Record<string, Record<string, unknown>>;
  personalViewMapBackup: Record<string, Record<string, unknown>>;
  isPersonalView: (viewId: string) => boolean;
  setPersonalViewMap: (
    viewId: string,
    updater: (prev: Record<string, unknown>) => Record<string, unknown>
  ) => void;
  removePersonalView: (viewId: string) => void;
  backupPersonalView: (viewId: string) => void;
  restorePersonalView: (viewId: string) => boolean;
}

export const usePersonalViewStore = create<IPersonalViewState>()(
  persist(
    (set, get) => ({
      personalViewMap: {},
      personalViewMapBackup: {},
      isPersonalView: (viewId) => {
        const state = get();
        return Boolean(state.personalViewMap[viewId]);
      },
      setPersonalViewMap: (viewId, updater) =>
        set((state) => ({
          personalViewMap: {
            ...state.personalViewMap,
            [viewId]: updater(state.personalViewMap[viewId] ?? {}),
          },
        })),
      removePersonalView: (viewId) =>
        set((state) => {
          const { [viewId]: _, ...rest } = state.personalViewMap;
          return { personalViewMap: rest };
        }),
      backupPersonalView: (viewId) =>
        set((state) => {
          const currentView = state.personalViewMap[viewId];
          if (!currentView) return state;
          return {
            personalViewMapBackup: {
              ...state.personalViewMapBackup,
              [viewId]: { ...currentView },
            },
          };
        }),
      restorePersonalView: (viewId) => {
        const state = get();
        const backup = state.personalViewMapBackup[viewId];
        if (!backup) return false;

        set((state) => ({
          personalViewMap: {
            ...state.personalViewMap,
            [viewId]: { ...backup },
          },
        }));
        return true;
      },
    }),
    {
      name: LocalStorageKeys.PersonalViewMap,
    }
  )
);
