export interface IAppDeleteConfirmDialogProps {
  open: boolean;
  appId: string;
  appName: string;
  /** A published app goes offline the moment it is deleted, and restoring it does not republish it. */
  published: boolean;
  isDeleting?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export const AppDeleteConfirmDialog = (_props: IAppDeleteConfirmDialogProps) => null;
