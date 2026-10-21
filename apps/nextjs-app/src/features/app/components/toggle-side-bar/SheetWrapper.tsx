import { ChevronsRight } from '@teable/icons';
import { Sheet, SheetContent, Button, SheetTrigger } from '@teable/ui-lib';
import { cn } from '@teable/ui-lib/shadcn';
import { createContext, useContext, useMemo, useState } from 'react';

interface SheetWrapperProps {
  children: React.ReactNode;
  triggerTopOffset?: string;
}

const MobileSidebarSheetContext = createContext<(() => void) | undefined>(undefined);

export const useCloseMobileSidebarSheet = () => useContext(MobileSidebarSheetContext);

export const SheetWrapper = (props: SheetWrapperProps) => {
  const { children, triggerTopOffset = '1.75rem' } = props;
  const [open, setOpen] = useState(false);
  const close = useMemo(() => () => setOpen(false), []);

  return (
    <MobileSidebarSheetContext.Provider value={close}>
      <Sheet modal={true} open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            className={cn('fixed start-0 z-50 p-1 transition-all rounded-e-full rounded-s-none')}
            style={{ top: `calc(var(--teable-top-banner-height) + ${triggerTopOffset})` }}
            size="icon-xs"
            variant={'outline'}
          >
            <ChevronsRight className="size-5 shrink-0" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0" closeable={false}>
          {children}
        </SheetContent>
      </Sheet>
    </MobileSidebarSheetContext.Provider>
  );
};
