import { create } from 'zustand';

interface IBuildBaseStore {
  building: boolean;
  setBuilding: (building: boolean) => void;
}

export const useBuildBaseAgentStore = create<IBuildBaseStore>()((set) => ({
  building: false,
  setBuilding: (building: boolean) => set({ building }),
}));
