import { create } from 'zustand';

interface IBuildBaseStore {
  building: boolean;
  setBuilding: (building: boolean) => void;
  currentAction: unknown;
}

export const useAiBuildBaseStore = create<IBuildBaseStore>()((set) => ({
  building: false,
  setBuilding: (building: boolean) => set({ building }),
  currentAction: undefined,
  setCurrentAction: (currentAction: unknown) => set({ currentAction }),
}));
