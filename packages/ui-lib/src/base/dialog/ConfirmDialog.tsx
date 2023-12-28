import React from 'react';
import { ContentDialog } from './ContentDialog';

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
  const { title, description, ...common } = props;

  return (
    <ContentDialog
      {...common}
      content={
        <>
          {title && <div className="text-base font-medium">{title}</div>}
          {description && <div className="text-sm text-muted-foreground">{description}</div>}
        </>
      }
    />
  );
};
