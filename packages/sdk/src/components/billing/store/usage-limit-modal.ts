import { create } from 'zustand';

export enum UsageLimitModalType {
  Upgrade = 'upgrade',
  User = 'user',
  CreditInsufficient = 'credit_insufficient',
}

interface IUsageLimitModalState {
  modalType: UsageLimitModalType;
  modalOpen: boolean;

  openModal: (modalType: UsageLimitModalType) => void;
  closeModal: () => void;
  toggleModal: (open: boolean) => void;
}

export const useUsageLimitModalStore = create<IUsageLimitModalState>((set) => ({
  modalType: UsageLimitModalType.Upgrade,
  modalOpen: false,
  openModal: (modalType: UsageLimitModalType) => {
    set((state) => {
      return {
        ...state,
        modalType,
        modalOpen: true,
      };
    });
  },
  closeModal: () => {
    set((state) => {
      return {
        ...state,
        modalOpen: false,
      };
    });
  },
  toggleModal: (open: boolean) => {
    set((state) => {
      return {
        ...state,
        modalOpen: open,
      };
    });
  },
}));
