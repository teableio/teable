import { ChevronsRight } from '@teable-group/icons';
import { Sheet, SheetContent, Button, SheetTrigger } from '@teable-group/ui-lib';
import classNames from 'classnames';
import { SideBarFooter } from '@/features/app/components/SideBarFooter';
import { BaseSideBar } from './BaseSideBar';
import { SideBarHeader } from './SideBarHeader';

export const SideBar = () => {
  return (
    <div className="flex h-full basis-[300px] flex-col overflow-hidden">
      <SideBarHeader />
      <div className="divide-base-300 flex flex-col gap-2 divide-y divide-solid overflow-hidden py-2">
        <BaseSideBar />
      </div>
      <div className="grow basis-0"></div>
      <SideBarFooter />
    </div>
  );
};

export const SheetSideBar = (props: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const { open, onOpenChange } = props;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetTrigger>
        {!open && (
          <Button
            className={classNames(
              'fixed left-0 p-1 top-7 transition-all rounded-r-full rounded-l-none'
            )}
            size="xs"
            variant={'outline'}
          >
            <ChevronsRight className="h-5 w-5" />
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="left" className="px-0">
        <SideBar></SideBar>
      </SheetContent>
    </Sheet>
  );
};
