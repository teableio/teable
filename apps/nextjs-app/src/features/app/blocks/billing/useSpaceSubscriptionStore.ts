import type { BillingProductLevel } from '@teable/openapi';
import { create } from 'zustand';

interface ISpaceSubscriptionState {
  subscribeLevel?: BillingProductLevel;
  closeModal: () => void;
  openModal: (subscribeLevel: BillingProductLevel) => void;
}

export const useSpaceSubscriptionStore = create<ISpaceSubscriptionState>((set) => ({
  closeModal: () => {
    set((state) => {
      return {
        ...state,
        subscribeLevel: undefined,
      };
    });
  },
  openModal: (subscribeLevel: BillingProductLevel) => {
    set((state) => {
      return {
        ...state,
        subscribeLevel,
      };
    });
  },
}));
