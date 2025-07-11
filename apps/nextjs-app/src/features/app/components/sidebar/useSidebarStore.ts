import { create } from 'zustand';
interface ISidebarState {
  isVisible: boolean;
  setVisible: (isVisible: boolean) => void;
}

export const useSidebarStore = create<ISidebarState>()((set) => ({
  isVisible: false,
  setVisible: (isVisible: boolean) => set({ isVisible }),
}));
