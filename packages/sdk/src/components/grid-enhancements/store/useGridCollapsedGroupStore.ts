import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LocalStorageKeys } from '../../../config';

interface IGridCollapsedGroupState {
  collapsedGroupMap: Record<string, string[]>;
  setCollapsedGroupMap: (key: string, groupIds: string[]) => void;
}

export const useGridCollapsedGroupStore = create<IGridCollapsedGroupState>()(
  persist(
    (set, get) => ({
      collapsedGroupMap: {},
      setCollapsedGroupMap: (key: string, groupIds: string[]) => {
        set({
          collapsedGroupMap: {
            ...get().collapsedGroupMap,
            [key]: groupIds,
          },
        });
      },
    }),
    {
      name: LocalStorageKeys.ViewGridCollapsedGroup,
    }
  )
);
