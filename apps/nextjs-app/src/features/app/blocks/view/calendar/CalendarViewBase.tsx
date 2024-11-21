import { CalendarDailyCollectionProvider } from '@teable/sdk/context';
import { useState } from 'react';
import { Calendar } from './components/Calendar';
import { useCalendar } from './hooks';

export const CalendarViewBase = () => {
  const { startDateField, endDateField } = useCalendar();
  const [dateRange, setDateRange] = useState<{
    startDate: string;
    endDate: string;
  }>();

  return (
    <CalendarDailyCollectionProvider
      startDate={dateRange?.startDate}
      endDate={dateRange?.endDate}
      startDateFieldId={startDateField?.id}
      endDateFieldId={endDateField?.id}
    >
      <Calendar setDateRange={setDateRange} />
    </CalendarDailyCollectionProvider>
  );
};
