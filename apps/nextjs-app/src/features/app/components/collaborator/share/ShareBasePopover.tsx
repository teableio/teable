import type { IRole } from '@teable/core';
import { cn, Popover, PopoverTrigger, PopoverContent } from '@teable/ui-lib/shadcn';
import { useState } from 'react';
import { ShareBaseContent } from './ShareBaseContent';

interface IShareBasePopoverProps {
  base: {
    name: string;
    role: IRole;
    id: string;
    enabledAuthority?: boolean;
  };
  children: React.ReactNode;
}

export const ShareBasePopover = (props: IShareBasePopoverProps) => {
  const { base, children } = props;
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
          'h-auto w-[480px] max-w-[100vw] rounded-xl border p-6 shadow-lg',
          !isSubPage && 'pb-3'
        )}
        align="end"
      >
        <ShareBaseContent
          baseId={base.id}
          baseName={base.name}
          role={base.role}
          enabledAuthority={base.enabledAuthority}
          onClose={onClose}
          onSubPageChange={setIsSubPage}
        />
      </PopoverContent>
    </Popover>
  );
};
