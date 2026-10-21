import type { ICustomHttpExceptionData, IHttpError, ILocalization } from '@teable/core';
import { HttpErrorCode } from '@teable/core';
import { create } from 'zustand';

export enum UsageLimitModalType {
  Upgrade = 'upgrade',
  User = 'user',
  CreditInsufficient = 'credit_insufficient',
}

/**
 * Why the usage-limit modal opened: which plan feature was exceeded and the
 * usage numbers, extracted from the backend error envelope so the modal can
 * tell the user what they ran into instead of only showing plan cards.
 */
export interface IUsageLimitReason {
  feature?: string;
  limit?: number;
  current?: number;
  /** Rows the rejected operation attempted to add (e.g. a bulk paste). */
  increment?: number;
  message?: string;
  localization?: ILocalization;
}

export const extractUsageLimitReason = (error: unknown): IUsageLimitReason | null => {
  if (error == null || typeof error !== 'object') return null;
  const { message, data } = error as IHttpError;
  const { feature, limit, current, increment, localization } = ((typeof data === 'object' &&
    data) ||
    {}) as {
    feature?: unknown;
    limit?: unknown;
    current?: unknown;
    increment?: unknown;
  } & ICustomHttpExceptionData;

  const reason: IUsageLimitReason = {
    ...(typeof feature === 'string' ? { feature } : {}),
    ...(typeof limit === 'number' ? { limit } : {}),
    ...(typeof current === 'number' ? { current } : {}),
    ...(typeof increment === 'number' ? { increment } : {}),
    ...(typeof message === 'string' && message ? { message } : {}),
    ...(localization ? { localization } : {}),
  };
  return Object.keys(reason).length ? reason : null;
};

/**
 * Open the usage-limit modal when the error is a billing 402 or user-limit 460.
 * Returns true when the error was handled. Shared by the react-query global
 * onError and request paths that bypass react-query entirely (e.g. the
 * attachment upload manager, which calls the signature API with raw axios).
 */
export const openUsageLimitModalFromError = (error: unknown): boolean => {
  if (error == null || typeof error !== 'object') return false;
  const { status, code } = error as IHttpError;
  if (status === 402) {
    // Credit exhaustion opens the purchase-credits modal; other 402s (plan
    // limits, PAYMENT_REQUIRED) keep the plan-upgrade modal.
    const modalType =
      code === HttpErrorCode.CREDIT_LIMIT_EXCEEDED
        ? UsageLimitModalType.CreditInsufficient
        : UsageLimitModalType.Upgrade;
    useUsageLimitModalStore.setState({
      modalType,
      modalOpen: true,
      reason: extractUsageLimitReason(error),
    });
    return true;
  }
  if (status === 460) {
    useUsageLimitModalStore.setState({
      modalType: UsageLimitModalType.User,
      modalOpen: true,
      reason: extractUsageLimitReason(error),
    });
    return true;
  }
  return false;
};

interface IUsageLimitModalState {
  modalType: UsageLimitModalType;
  modalOpen: boolean;
  reason: IUsageLimitReason | null;

  openModal: (modalType: UsageLimitModalType, reason?: IUsageLimitReason | null) => void;
  closeModal: () => void;
  toggleModal: (open: boolean) => void;
}

export const useUsageLimitModalStore = create<IUsageLimitModalState>((set) => ({
  modalType: UsageLimitModalType.Upgrade,
  modalOpen: false,
  reason: null,
  openModal: (modalType: UsageLimitModalType, reason: IUsageLimitReason | null = null) => {
    set((state) => {
      return {
        ...state,
        modalType,
        modalOpen: true,
        reason,
      };
    });
  },
  closeModal: () => {
    set((state) => {
      return {
        ...state,
        modalOpen: false,
        reason: null,
      };
    });
  },
  toggleModal: (open: boolean) => {
    set((state) => {
      return {
        ...state,
        modalOpen: open,
        // Drop the stale reason on close so the next open (e.g. from a
        // feature-gate badge) doesn't show an unrelated explanation.
        ...(open ? {} : { reason: null }),
      };
    });
  },
}));
