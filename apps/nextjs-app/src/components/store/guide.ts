import { LocalStorageKeys } from '@teable/sdk/config';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ICompletedGuideMapState {
  completedGuideMap: Record<string, string[]>;
  setCompletedGuideMap: (userId: string, stepKeys: string[]) => void;
}

export const useCompletedGuideMapStore = create<ICompletedGuideMapState>()(
  persist(
    (set, get) => ({
      completedGuideMap: {},
      setCompletedGuideMap: (userId: string, stepKeys: string[]) => {
        set({
          completedGuideMap: {
            ...get().completedGuideMap,
            [userId]: stepKeys,
          },
        });
      },
    }),
    {
      name: LocalStorageKeys.CompletedGuideMap,
    }
  )
);
