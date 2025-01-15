import { CalendarDailyCollectionProvider } from '@teable/sdk/context';
import { usePersonalView } from '@teable/sdk/hooks';
import { Fragment, useMemo, useState } from 'react';
import { AddDateFieldDialog } from './components/AddDateFieldDialog';
import { Calendar } from './components/Calendar';
import { useCalendar } from './hooks';

export const CalendarViewBase = () => {
  const { startDateField, endDateField } = useCalendar();
  const { personalViewCommonQuery } = usePersonalView();
  const [dateRange, setDateRange] = useState<{
    startDate: string;
    endDate: string;
  }>();

  const query = useMemo(() => {
    return {
      startDate: dateRange?.startDate || '',
      endDate: dateRange?.endDate || '',
      startDateFieldId: startDateField?.id || '',
      endDateFieldId: endDateField?.id || '',
      filter: personalViewCommonQuery?.filter,
      ignoreViewQuery: personalViewCommonQuery?.ignoreViewQuery || false,
    };
  }, [dateRange, startDateField, endDateField, personalViewCommonQuery]);

  return (
    <Fragment>
      <CalendarDailyCollectionProvider query={query}>
        <Calendar dateRange={dateRange} setDateRange={setDateRange} />
      </CalendarDailyCollectionProvider>
      <AddDateFieldDialog />
    </Fragment>
  );
};
