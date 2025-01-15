import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LocalStorageKeys } from '../../../config';

interface IPersonalViewState {
  personalViewMap: Record<string, Record<string, unknown>>;
  isPersonalView: (viewId: string) => boolean;
  setPersonalViewMap: (
    viewId: string,
    updater: (prev: Record<string, unknown>) => Record<string, unknown>
  ) => void;
  removePersonalView: (viewId: string) => void;
}

export const usePersonalViewStore = create<IPersonalViewState>()(
  persist(
    (set, get) => ({
      personalViewMap: {},
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
    }),
    {
      name: LocalStorageKeys.PersonalViewMap,
    }
  )
);
