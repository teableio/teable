import { useContext } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LocalStorageKeys } from '../../../config';
import { AppContext } from '../../app/AppContext';
import type { IPersonalViewStoreApi } from './ShareSessionViewStore';
import { useShareSessionViewStore } from './ShareSessionViewStore';

interface IPersonalViewState {
  personalViewMap: Record<string, Record<string, unknown>>;
  isPersonalView: (viewId: string) => boolean;
  setPersonalViewMap: (
    viewId: string,
    updater: (prev: Record<string, unknown>) => Record<string, unknown>
  ) => void;
  removePersonalView: (viewId: string) => void;
}

/**
 * In share/template mode, use the non-persisted session store (memory only).
 * Otherwise, use the localStorage-persisted store.
 */
export const useResolvedPersonalViewStore = (): IPersonalViewStoreApi => {
  const { shareId, template } = useContext(AppContext) || {};
  const sessionStore = useShareSessionViewStore();
  const zustandStore = usePersonalViewStore();
  return shareId || template ? sessionStore : zustandStore;
};

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
