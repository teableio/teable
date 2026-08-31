import { useCallback } from 'react';
import type { IConfirmModalOptions } from './context';
import { useConfirmModal } from './context';

export const useConfirm = () => {
  const { openModal } = useConfirmModal();

  const confirm = useCallback(
    (options: Omit<IConfirmModalOptions, 'onConfirm' | 'onCancel'>): Promise<boolean> => {
      return new Promise((resolve) => {
        openModal({
          ...options,
          onConfirm: () => {
            resolve(true);
          },
          onCancel: () => {
            resolve(false);
          },
        });
      });
    },
    [openModal]
  );

  // single-button acknowledgement dialog; resolves when dismissed
  const alert = useCallback(
    (
      options: Omit<IConfirmModalOptions, 'onConfirm' | 'onCancel' | 'cancelText'>
    ): Promise<void> => {
      return new Promise((resolve) => {
        openModal({
          ...options,
          onConfirm: () => {
            resolve();
          },
          onCancel: () => {
            resolve();
          },
        });
      });
    },
    [openModal]
  );

  return { confirm, alert };
};

export const useConfirmWithCallback = () => {
  const { openModal } = useConfirmModal();

  const confirmWithCallback = (options: IConfirmModalOptions): void => {
    openModal(options);
  };

  return { confirmWithCallback };
};
