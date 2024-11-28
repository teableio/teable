import type { IFilter } from '@teable/core';
import { mergeFilter, and, exactDate, isOnOrBefore, isOnOrAfter, or, is } from '@teable/core';
import { RowCountProvider } from '@teable/sdk/context';
import { endOfDay, startOfDay } from 'date-fns';
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
                    exactDate: endOfDay(date).toISOString(),
                    mode: exactDate.value,
                    timeZone: startDateField.options.formatting.timeZone,
                  },
                },
                {
                  fieldId: endDateField.id,
                  operator: isOnOrAfter.value,
                  value: {
                    exactDate: startOfDay(date).toISOString(),
                    mode: exactDate.value,
                    timeZone: endDateField.options.formatting.timeZone,
                  },
                },
              ],
            },
            {
              fieldId: startDateField.id,
              operator: is.value,
              value: {
                exactDate: date.toISOString(),
                mode: exactDate.value,
                timeZone: startDateField.options.formatting.timeZone,
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
