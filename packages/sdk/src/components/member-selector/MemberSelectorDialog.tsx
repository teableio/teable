import { Dialog, DialogContent, DialogTrigger } from '@teable/ui-lib';
import * as React from 'react';
import { MemberContent } from './MemberContent';

interface IMemberSelectorDialogProps {
  organizationId: string;
  departmentId?: string;
  children: React.ReactNode;
}

export function MemberSelectorDialog({
  organizationId,
  departmentId,
  children,
}: IMemberSelectorDialogProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="w-[80vw] min-w-[600px]  max-w-6xl">
        <MemberContent
          className="h-[80vh]"
          organizationId={organizationId}
          departmentId={departmentId}
          onCancel={() => setOpen(false)}
          onConfirm={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
