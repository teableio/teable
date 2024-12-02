import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ITableActionKey, IViewActionKey } from '@teable/core';
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
  startDate?: string;
  endDate?: string;
  startDateFieldId?: string;
  endDateFieldId?: string;
}

export const CalendarDailyCollectionProvider: FC<ICalendarDailyCollectionProviderProps> = ({
  children,
  startDate,
  endDate,
  startDateFieldId,
  endDateFieldId,
}) => {
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
  const queryClient = useQueryClient();
  const { searchQuery } = useSearch();
  const { shareId } = useContext(ShareViewContext);
  const view = useView() as CalendarView | undefined;
  const shareFilter = shareId ? view?.filter : undefined;

  const isEnabled = Boolean(startDate && endDate && startDateFieldId && endDateFieldId);

  const query = useMemo(
    () => ({
      viewId,
      search: searchQuery,
      startDate: startDate || '',
      endDate: endDate || '',
      startDateFieldId: startDateFieldId || '',
      endDateFieldId: endDateFieldId || '',
      filter: shareFilter,
    }),
    [searchQuery, viewId, startDate, endDate, startDateFieldId, endDateFieldId, shareFilter]
  );

  const queryKey = useMemo(
    () => ReactQueryKeys.calendarDailyCollection(shareId || (tableId as string), query),
    [shareId, tableId, query]
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
    (cleanAll?: boolean) =>
      queryClient.invalidateQueries({
        queryKey: queryKey.slice(0, cleanAll ? 2 : 3),
      }),
    [queryClient, queryKey]
  );

  const updateCalendarDailyCollectionForTable = useCallback(
    () => updateCalendarDailyCollection(true),
    [updateCalendarDailyCollection]
  );

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
