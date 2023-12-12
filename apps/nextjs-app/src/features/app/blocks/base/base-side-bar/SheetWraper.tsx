import { ChevronsRight } from '@teable-group/icons';
import { Sheet, SheetContent, Button, SheetTrigger } from '@teable-group/ui-lib';
import classNames from 'classnames';

interface SheetWraperProps {
  open: boolean;
  children: React.ReactNode;
  onOpenChange: (open: boolean) => void;
}

export const SheetWraper = (props: SheetWraperProps) => {
  const { open, onOpenChange, children } = props;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetTrigger>
        {!open && (
          <Button
            className={classNames(
              'fixed left-0 z-50 p-1 top-7 transition-all rounded-r-full rounded-l-none'
            )}
            size="xs"
            variant={'outline'}
          >
            <ChevronsRight className="h-5 w-5" />
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="left" className="px-0">
        {children}
      </SheetContent>
    </Sheet>
  );
};
