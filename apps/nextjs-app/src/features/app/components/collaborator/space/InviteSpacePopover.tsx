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
  /** Which edge of the trigger the content lines up with; a full-width sidebar row wants `start`. */
  align?: 'start' | 'center' | 'end';
  /** Extra classes for the popover card, e.g. a narrower width where the trigger sits in a sidebar. */
  className?: string;
}

export const InviteSpacePopover = (props: IInviteSpacePopoverProps) => {
  const { space, children, align = 'end', className } = props;
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
        className={cn(
          'h-auto w-[480px] rounded-xl border p-6 shadow-lg',
          !isSubPage && 'pb-3',
          className
        )}
        align={align}
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
