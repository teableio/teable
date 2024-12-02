import { CalendarDailyCollectionProvider } from '@teable/sdk/context';
import { Fragment, useState } from 'react';
import { AddDateFieldDialog } from './components/AddDateFieldDialog';
import { Calendar } from './components/Calendar';
import { useCalendar } from './hooks';

export const CalendarViewBase = () => {
  const { startDateField, endDateField } = useCalendar();
  const [dateRange, setDateRange] = useState<{
    startDate: string;
    endDate: string;
  }>();

  return (
    <Fragment>
      <CalendarDailyCollectionProvider
        startDate={dateRange?.startDate}
        endDate={dateRange?.endDate}
        startDateFieldId={startDateField?.id}
        endDateFieldId={endDateField?.id}
      >
        <Calendar dateRange={dateRange} setDateRange={setDateRange} />
      </CalendarDailyCollectionProvider>
      <AddDateFieldDialog />
    </Fragment>
  );
};
