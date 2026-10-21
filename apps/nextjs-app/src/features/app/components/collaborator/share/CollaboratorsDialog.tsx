import { Dialog, DialogContent, DialogTrigger } from '@teable/ui-lib/shadcn';
import { forwardRef, useImperativeHandle, useState } from 'react';

interface ICollaboratorsDialogProps {
  children: React.ReactNode;
  title: string;
  alert?: React.ReactNode;
  content: React.ReactNode;
}

interface ICollaboratorsDialogRef {
  open: () => void;
  close: () => void;
}
export const CollaboratorsDialog = forwardRef<ICollaboratorsDialogRef, ICollaboratorsDialogProps>(
  ({ children, title, alert, content }: ICollaboratorsDialogProps, ref) => {
    const [open, setOpen] = useState(false);

    useImperativeHandle(ref, () => ({
      open: () => setOpen(true),
      close: () => setOpen(false),
    }));

    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent className="flex h-[85%] max-w-3xl flex-col gap-4 rounded-xl border p-6 shadow-none">
          <h2 className="text-base font-semibold">{title}</h2>
          {alert}
          {content}
        </DialogContent>
      </Dialog>
    );
  }
);

CollaboratorsDialog.displayName = 'CollaboratorsDialog';
