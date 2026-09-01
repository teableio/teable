import { RecordProvider, ShareViewContext } from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { useIsHydrated } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useContext } from 'react';
import { CalendarViewBase } from '@/features/app/blocks/view/calendar/CalendarViewBase';
import { CalendarProvider } from '@/features/app/blocks/view/calendar/context';
import { ShareViewHeader } from '../../ShareSignInButton';
import { CalendarToolbar } from './toolbar';

export const CalendarView = () => {
  const { view } = useContext(ShareViewContext);
  const isHydrated = useIsHydrated();
  const {
    query: { hideToolBar, embed },
  } = useRouter();

  return (
    <div className={cn('flex size-full flex-col', embed ? '' : 'md:px-3 md:pb-3')}>
      {!embed && <ShareViewHeader viewName={view?.name} />}
      <div className="flex w-full grow flex-col overflow-hidden border md:rounded md:shadow-md">
        <SearchProvider>
          <RecordProvider>
            {!hideToolBar && <CalendarToolbar />}
            <CalendarProvider>
              <div className="w-full grow overflow-hidden">
                {isHydrated && <CalendarViewBase />}
              </div>
            </CalendarProvider>
          </RecordProvider>
        </SearchProvider>
      </div>
    </div>
  );
};
