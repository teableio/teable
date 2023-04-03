import * as Toast from '@radix-ui/react-toast';
import type { ReactNode } from 'react';
import React, { useCallback, useMemo, useState } from 'react';
import type { IToastParams } from './ToastContext';
import { ToastContext } from './ToastContext';

export const ToastProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState<ReactNode>('');
  const [description, setDescription] = useState<ReactNode>('');

  const openToast = useCallback((params: IToastParams | string) => {
    if (typeof params === 'string') {
      setTitle(params);
    } else {
      setTitle(params.title || '');
      setDescription(params.description || '');
    }
  }, []);

  const contextValue = useMemo(() => {
    return { open: openToast };
  }, [openToast]);

  return (
    <ToastContext.Provider value={contextValue}>
      <Toast.Provider swipeDirection="up">
        {children}
        <Toast.Root className="ToastRoot" open={open} onOpenChange={setOpen}>
          <Toast.Title className="ToastTitle">{title}</Toast.Title>
          <Toast.Description asChild>{description}</Toast.Description>
          <Toast.Action className="ToastAction" asChild altText="Goto schedule to undo">
            <button className="Button small green">Undo</button>
          </Toast.Action>
        </Toast.Root>
        <Toast.Viewport className="ToastViewport" />
      </Toast.Provider>
    </ToastContext.Provider>
  );
};
