import type { IRole } from '@teable/core';
import { Popover, PopoverTrigger, PopoverContent } from '@teable/ui-lib/shadcn';
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
  const onClose = () => setOpen(false);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="h-auto w-[480px] max-w-[100vw] rounded-xl border p-6 shadow-lg"
        align="end"
      >
        <ShareBaseContent
          baseId={base.id}
          baseName={base.name}
          role={base.role}
          enabledAuthority={base.enabledAuthority}
          onClose={onClose}
        />
      </PopoverContent>
    </Popover>
  );
};
