import type { IFilter } from '@teable/core';
import { mergeFilter, and, exactDate, isOnOrBefore, isOnOrAfter, or, is } from '@teable/core';
import { RowCountProvider } from '@teable/sdk/context';
import { format } from 'date-fns';
import { zonedTimeToUtc } from 'date-fns-tz';
import { useMemo } from 'react';
import { useCalendar } from '../hooks';
import { EventList } from './EventList';

interface IEventListContainerProps {
  date: Date;
}

export const EventListContainer = (props: IEventListContainerProps) => {
  const { date } = props;
  const { recordQuery, startDateField, endDateField } = useCalendar();

  const query = useMemo(() => {
    if (!startDateField || !endDateField) return;

    const { timeZone } = startDateField.options.formatting;

    const dateStr = format(date, 'yyyy-MM-dd');
    const startDateUtc = zonedTimeToUtc(`${dateStr} 00:00:00`, timeZone);
    const endDateUtc = zonedTimeToUtc(`${dateStr} 23:59:59.999`, timeZone);

    const filter = mergeFilter(recordQuery?.filter, {
      conjunction: and.value,
      filterSet: [
        {
          conjunction: or.value,
          filterSet: [
            {
              conjunction: and.value,
              filterSet: [
                {
                  fieldId: startDateField.id,
                  operator: isOnOrBefore.value,
                  value: {
                    exactDate: endDateUtc.toISOString(),
                    mode: exactDate.value,
                    timeZone,
                  },
                },
                {
                  fieldId: endDateField.id,
                  operator: isOnOrAfter.value,
                  value: {
                    exactDate: startDateUtc.toISOString(),
                    mode: exactDate.value,
                    timeZone,
                  },
                },
              ],
            },
            {
              fieldId: startDateField.id,
              operator: is.value,
              value: {
                exactDate: startDateUtc.toISOString(),
                mode: exactDate.value,
                timeZone,
              },
            },
          ],
        },
      ],
    }) as IFilter;

    return {
      ...recordQuery,
      filter,
      orderBy: [
        {
          fieldId: startDateField.id,
          order: 'asc',
        },
      ],
    };
  }, [date, recordQuery, endDateField, startDateField]);

  return (
    <RowCountProvider query={query}>
      <EventList query={query} />
    </RowCountProvider>
  );
};
