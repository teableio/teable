import { create } from 'zustand';

export interface IPersonalViewStoreApi {
  personalViewMap: Record<string, Record<string, unknown>>;
  isPersonalView: (viewId: string) => boolean;
  setPersonalViewMap: (
    viewId: string,
    updater: (prev: Record<string, unknown>) => Record<string, unknown>
  ) => void;
  removePersonalView: (viewId: string) => void;
}

/**
 * Non-persisted zustand store for share mode personal views.
 * Data lives in memory (per tab) and is lost on page refresh — no localStorage,
 * no React context Provider needed, so the component tree stays unchanged.
 */
export const useShareSessionViewStore = create<IPersonalViewStoreApi>()((set, get) => ({
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
}));
