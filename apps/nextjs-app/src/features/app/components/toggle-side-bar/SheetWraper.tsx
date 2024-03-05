import { ChevronsRight } from '@teable/icons';
import { Sheet, SheetContent, Button, SheetTrigger } from '@teable/ui-lib';
import classNames from 'classnames';

interface SheetWraperProps {
  children: React.ReactNode;
}

export const SheetWraper = (props: SheetWraperProps) => {
  const { children } = props;

  return (
    <Sheet modal={false}>
      <SheetTrigger>
        {
          <Button
            className={classNames(
              'fixed left-0 z-50 p-1 top-7 transition-all rounded-r-full rounded-l-none'
            )}
            size="xs"
            variant={'outline'}
          >
            <ChevronsRight className="size-5" />
          </Button>
        }
      </SheetTrigger>
      <SheetContent side="left" className="p-0" closeable={false}>
        {children}
      </SheetContent>
    </Sheet>
  );
};
