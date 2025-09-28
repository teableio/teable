import type { IConfirmModalOptions } from './context';
import { useConfirmModal } from './context';

export const useConfirm = () => {
  const { openModal } = useConfirmModal();

  const confirm = (
    options: Omit<IConfirmModalOptions, 'onConfirm' | 'onCancel'>
  ): Promise<boolean> => {
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
  };

  return { confirm };
};

export const useConfirmWithCallback = () => {
  const { openModal } = useConfirmModal();

  const confirmWithCallback = (options: IConfirmModalOptions): void => {
    openModal(options);
  };

  return { confirmWithCallback };
};
