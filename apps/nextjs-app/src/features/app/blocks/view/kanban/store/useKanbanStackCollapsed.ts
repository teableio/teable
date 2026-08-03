import { LocalStorageKeys } from '@teable/sdk/config';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface IKanbanStackCollapsedState {
  collapsedStackMap: Record<string, string[]>;
  setCollapsedStackMap: (key: string, stackIds: string[]) => void;
}

export const useKanbanStackCollapsedStore = create<IKanbanStackCollapsedState>()(
  persist(
    (set, get) => ({
      collapsedStackMap: {},
      setCollapsedStackMap: (key: string, stackIds: string[]) => {
        set({
          collapsedStackMap: {
            ...get().collapsedStackMap,
            [key]: stackIds,
          },
        });
      },
    }),
    {
      name: LocalStorageKeys.ViewKanbanCollapsedStack,
    }
  )
);
