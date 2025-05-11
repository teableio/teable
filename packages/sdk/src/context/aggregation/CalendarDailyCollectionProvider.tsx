import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ITableActionKey, IViewActionKey } from '@teable/core';
import type { ICalendarDailyCollectionRo } from '@teable/openapi';
import { getCalendarDailyCollection, getShareViewCalendarDailyCollection } from '@teable/openapi';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo } from 'react';
import { ReactQueryKeys } from '../../config';
import { useSearch, useIsHydrated, useTableListener, useViewListener, useView } from '../../hooks';
import type { CalendarView } from '../../model';
import { AnchorContext } from '../anchor';
import { ShareViewContext } from '../table/ShareViewContext';
import { CalendarDailyCollectionContext } from './CalendarDailyCollectionContext';

interface ICalendarDailyCollectionProviderProps {
  children: ReactNode;
  query?: ICalendarDailyCollectionRo;
}

export const CalendarDailyCollectionProvider: FC<ICalendarDailyCollectionProviderProps> = ({
  children,
  query,
}) => {
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
  const queryClient = useQueryClient();
  const { searchQuery } = useSearch();
  const { shareId } = useContext(ShareViewContext);
  const view = useView() as CalendarView | undefined;
  const viewFilter = view?.filter;
  const { startDate, endDate, startDateFieldId, endDateFieldId } = query ?? {};

  const isEnabled = Boolean(startDate && endDate && startDateFieldId && endDateFieldId);

  const calenderDailyCollectionQuery = useMemo(() => {
    const { startDate, endDate, startDateFieldId, endDateFieldId, filter, ignoreViewQuery } =
      query ?? {};
    return {
      viewId,
      search: searchQuery,
      startDate: startDate || '',
      endDate: endDate || '',
      startDateFieldId: startDateFieldId || '',
      endDateFieldId: endDateFieldId || '',
      filter: shareId ? viewFilter : filter,
      ignoreViewQuery,
    };
  }, [query, viewId, searchQuery, shareId, viewFilter]);

  const queryKey = useMemo(
    () =>
      ReactQueryKeys.calendarDailyCollection(
        shareId || (tableId as string),
        calenderDailyCollectionQuery
      ),
    [shareId, tableId, calenderDailyCollectionQuery]
  );

  const { data: commonCalendarDailyCollection } = useQuery({
    queryKey,
    queryFn: ({ queryKey }) =>
      getCalendarDailyCollection(queryKey[1], queryKey[2]).then(({ data }) => data),
    enabled: Boolean(!shareId && tableId && isHydrated && isEnabled),
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const { data: shareCalendarDailyCollection } = useQuery({
    queryKey,
    queryFn: ({ queryKey }) =>
      getShareViewCalendarDailyCollection(queryKey[1], queryKey[2]).then(({ data }) => data),
    enabled: Boolean(shareId && tableId && isHydrated && isEnabled),
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const resCalendarDailyCollection = shareId
    ? shareCalendarDailyCollection
    : commonCalendarDailyCollection;

  const updateCalendarDailyCollection = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: queryKey.slice(0, 3),
      }),
    [queryClient, queryKey]
  );

  const updateCalendarDailyCollectionForTable = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: queryKey.slice(0, 2),
    });
  }, [queryClient, queryKey]);

  const tableMatches = useMemo<ITableActionKey[]>(
    () => ['setRecord', 'addRecord', 'deleteRecord'],
    []
  );
  useTableListener(tableId, tableMatches, updateCalendarDailyCollectionForTable);

  const viewMatches = useMemo<IViewActionKey[]>(() => ['applyViewFilter'], []);
  useViewListener(viewId, viewMatches, updateCalendarDailyCollection);

  const calendarDailyCollection = useMemo(
    () => resCalendarDailyCollection || null,
    [resCalendarDailyCollection]
  );

  useEffect(() => {
    return () => {
      queryClient.removeQueries({ queryKey });
    };
  }, [queryClient, queryKey]);

  return (
    <CalendarDailyCollectionContext.Provider value={calendarDailyCollection}>
      {children}
    </CalendarDailyCollectionContext.Provider>
  );
};
