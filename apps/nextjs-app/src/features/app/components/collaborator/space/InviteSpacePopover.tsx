import type { IRole } from '@teable/core';
import { Popover, PopoverTrigger, PopoverContent } from '@teable/ui-lib/shadcn';
import { useState } from 'react';
import { InviteSpaceContent } from './InviteSpaceContent';

interface IInviteSpacePopoverProps {
  space: {
    id: string;
    name: string;
    role: IRole;
  };
  children: React.ReactNode;
}

export const InviteSpacePopover = (props: IInviteSpacePopoverProps) => {
  const { space, children } = props;
  const [open, setOpen] = useState(false);
  const onClose = () => setOpen(false);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="h-auto w-[480px] rounded-xl border p-6 shadow-lg" align="end">
        <InviteSpaceContent
          spaceId={space.id}
          spaceName={space.name}
          role={space.role}
          onClose={onClose}
        />
      </PopoverContent>
    </Popover>
  );
};
