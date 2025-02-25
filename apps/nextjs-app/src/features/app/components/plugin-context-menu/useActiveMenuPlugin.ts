import { create } from 'zustand';

type ActiveMenuPluginState = {
  activePluginId: string | null;
  setActivePluginId: (id: string | null) => void;
};

export const useActiveMenuPluginStore = create<ActiveMenuPluginState>((set) => ({
  activePluginId: null,
  setActivePluginId: (id) => set({ activePluginId: id }),
}));
