import { create } from 'zustand';

interface IBillingUpgradeState {
  modalOpen: boolean;
  openUpgradeModal: () => void;
  closeUpgradeModal: () => void;
  toggleUpgradeModal: (open: boolean) => void;
}

export const useBillingUpgradeStore = create<IBillingUpgradeState>((set) => ({
  modalOpen: false,
  openUpgradeModal: () => {
    set((state) => {
      return {
        ...state,
        modalOpen: true,
      };
    });
  },
  closeUpgradeModal: () => {
    set((state) => {
      return {
        ...state,
        modalOpen: false,
      };
    });
  },
  toggleUpgradeModal: (open: boolean) => {
    set((state) => {
      return {
        ...state,
        modalOpen: open,
      };
    });
  },
}));
