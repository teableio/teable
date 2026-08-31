import { ChevronsRight } from '@teable/icons';
import { Sheet, SheetContent, Button, SheetTrigger } from '@teable/ui-lib';
import { cn } from '@teable/ui-lib/shadcn';

interface SheetWrapperProps {
  children: React.ReactNode;
  triggerTopOffset?: string;
}

export const SheetWrapper = (props: SheetWrapperProps) => {
  const { children, triggerTopOffset = '1.75rem' } = props;

  return (
    <Sheet modal={true}>
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
  );
};
