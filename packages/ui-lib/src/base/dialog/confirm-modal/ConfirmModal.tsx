import React, { useState, useCallback } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../shadcn';
import { Spin } from '../../spin/Spin';
import { confirmModalContext, type IConfirmModalOptions } from './context';

export const ConfirmModalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<IConfirmModalOptions>({});
  const [loading, setLoading] = useState(false);

  const openModal = useCallback((options: IConfirmModalOptions) => {
    setOptions(options);
    setOpen(true);
  }, []);

  const handleConfirm = async () => {
    if (options.onConfirm) {
      try {
        setLoading(true);
        await options.onConfirm();
      } catch (error) {
        console.error('Confirm modal error:', error);
      } finally {
        setLoading(false);
      }
    }
    setOpen(false);
    setOptions({});
  };

  const handleCancel = () => {
    if (options.onCancel) {
      options.onCancel();
    }
    setOpen(false);
    setOptions({});
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      handleCancel();
    }
  };

  return (
    <confirmModalContext.Provider value={{ openModal }}>
      {children}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          closeable={false}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {(options.title || options.description) && (
            <DialogHeader>
              {options.title && <DialogTitle>{options.title}</DialogTitle>}
              {options.description && <DialogDescription>{options.description}</DialogDescription>}
            </DialogHeader>
          )}
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={handleCancel} disabled={loading}>
              {options.cancelText}
            </Button>
            <Button
              size="sm"
              variant={options.confirmButtonVariant || 'default'}
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading && <Spin className="mr-2" />}
              {options.confirmText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </confirmModalContext.Provider>
  );
};
