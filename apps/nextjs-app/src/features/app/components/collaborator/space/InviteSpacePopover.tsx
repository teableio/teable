import type { IRole } from '@teable/core';
import { cn, Popover, PopoverTrigger, PopoverContent } from '@teable/ui-lib/shadcn';
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
  const [isSubPage, setIsSubPage] = useState(false);
  const onOpenChange = (open: boolean) => {
    setOpen(open);
    if (!open) setIsSubPage(false);
  };
  const onClose = () => onOpenChange(false);

  return (
    <Popover open={open} onOpenChange={onOpenChange} modal>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className={cn('h-auto w-[480px] rounded-xl border p-6 shadow-lg', !isSubPage && 'pb-3')}
        align="end"
      >
        <InviteSpaceContent
          spaceId={space.id}
          spaceName={space.name}
          role={space.role}
          onClose={onClose}
          onSubPageChange={setIsSubPage}
        />
      </PopoverContent>
    </Popover>
  );
};
