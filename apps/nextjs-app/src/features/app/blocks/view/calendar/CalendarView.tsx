import { RecordProvider } from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { useIsHydrated } from '@teable/sdk/hooks';
import { CalendarToolBar } from '../tool-bar/CalendarToolBar';
import { CalendarViewBase } from './CalendarViewBase';
import { CalendarProvider } from './context';

export const CalendarView = () => {
  const isHydrated = useIsHydrated();

  return (
    <SearchProvider>
      <RecordProvider>
        <CalendarToolBar />
        <CalendarProvider>
          <div className="w-full grow overflow-hidden">{isHydrated && <CalendarViewBase />}</div>
        </CalendarProvider>
      </RecordProvider>
    </SearchProvider>
  );
};
