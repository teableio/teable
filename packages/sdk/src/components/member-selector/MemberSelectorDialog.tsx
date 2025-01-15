import { Dialog, DialogContent, DialogTrigger } from '@teable/ui-lib';
import * as React from 'react';
import type { IMemberContentRef } from './MemberContent';
import { MemberContent } from './MemberContent';
import type { SelectedMemberWithData } from './types';

interface IMemberSelectorDialogProps {
  defaultSelectedMembers?: SelectedMemberWithData[];
  departmentId?: string;
  children?: React.ReactNode;
  disabledDepartment?: boolean;
  header?: React.ReactNode;
  onLoadData?: () => SelectedMemberWithData[];
  onConfirm?: (members: SelectedMemberWithData[]) => void;
  onCancel?: () => void;
}

export interface IMemberSelectorDialogRef {
  open: (selectedMembers?: SelectedMemberWithData[]) => void;
  close: () => void;
}

export const MemberSelectorDialog = React.forwardRef<
  IMemberSelectorDialogRef,
  IMemberSelectorDialogProps
>(
  (
    {
      header,
      children,
      departmentId,
      disabledDepartment,
      defaultSelectedMembers,
      onConfirm,
      onCancel,
      onLoadData,
    }: IMemberSelectorDialogProps,
    ref
  ) => {
    const [open, setOpen] = React.useState(false);
    const contentRef = React.useRef<IMemberContentRef>(null);

    React.useImperativeHandle(ref, () => ({
      open: (selectedMembers) => {
        contentRef.current?.open(selectedMembers);
        setOpen(true);
      },
      close: () => {
        setOpen(false);
      },
    }));

    const handleConfirm = (members: SelectedMemberWithData[]) => {
      onConfirm?.(members);
      setOpen(false);
    };

    const handleChange = (open: boolean) => {
      setOpen(open);
      if (!open) {
        onCancel?.();
      }
    };

    return (
      <Dialog open={open} onOpenChange={handleChange}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent className="w-[80vw] min-w-[600px]  max-w-6xl">
          <MemberContent
            ref={contentRef}
            header={header}
            className="h-[80vh]"
            departmentId={departmentId}
            disabledDepartment={disabledDepartment}
            defaultSelectedMembers={defaultSelectedMembers}
            onCancel={() => {
              handleChange(false);
            }}
            onLoadData={onLoadData}
            onConfirm={handleConfirm}
          />
        </DialogContent>
      </Dialog>
    );
  }
);

MemberSelectorDialog.displayName = 'MemberSelectorDialog';

export default MemberSelectorDialog;
