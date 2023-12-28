import React from 'react';
import { Button, Dialog, DialogContent, DialogFooter, DialogTrigger } from '../../shadcn';

interface IContentDialogProps {
  open?: boolean;
  children?: React.ReactNode;
  content?: React.ReactNode;
  cancelText?: string;
  confirmText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  onOpenChange?: (open: boolean) => void;
}
export const ContentDialog = (props: IContentDialogProps) => {
  const {
    open,
    onOpenChange,
    children,
    content,
    cancelText = 'Cancel',
    confirmText = 'Continue',
    onConfirm,
    onCancel,
  } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent
        closeable={false}
        overlayStyle={{
          pointerEvents: 'none',
        }}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
      >
        {content}
        <DialogFooter>
          <Button size={'sm'} variant={'ghost'} onClick={onCancel}>
            {cancelText}
          </Button>
          <Button size={'sm'} onClick={onConfirm}>
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
