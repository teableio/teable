import React from 'react';
import { Button, Dialog, DialogContent, DialogFooter, DialogTrigger } from '../../shadcn';

interface IConfirmDialogProps {
  open?: boolean;
  children?: React.ReactNode;
  title?: string | React.ReactNode;
  description?: string | React.ReactNode;
  cancelText?: string;
  confirmText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  onOpenChange?: (open: boolean) => void;
}
export const ConfirmDialog = (props: IConfirmDialogProps) => {
  const {
    open,
    onOpenChange,
    children,
    title,
    description,
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
        {title && <div className="text-base font-medium">{title}</div>}
        {description && <div className="text-sm text-muted-foreground">{description}</div>}
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
