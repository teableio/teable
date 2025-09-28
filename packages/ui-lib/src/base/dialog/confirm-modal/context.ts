import { createContext, useContext } from 'react';

export interface IConfirmModalOptions {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  confirmButtonVariant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
}

interface IConfirmModalContext {
  openModal: (options: IConfirmModalOptions) => void;
}

export const confirmModalContext = createContext<IConfirmModalContext | null>(null);

export const useConfirmModal = () => {
  const context = useContext(confirmModalContext);
  if (!context) {
    throw new Error('useConfirmModal must be used within ConfirmModalProvider');
  }
  return context;
};
