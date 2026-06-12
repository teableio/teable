import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IFilter, ITableActionKey, IViewActionKey } from '@teable/core';
import type { ICalendarDailyCollectionRo } from '@teable/openapi';
import { getCalendarDailyCollection, getShareViewCalendarDailyCollection } from '@teable/openapi';
import { throttle } from 'lodash';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo } from 'react';
import { ReactQueryKeys } from '../../config';
import { useSearch, useIsHydrated, useViewListener, useView } from '../../hooks';
import { useDocumentVisible } from '../../hooks/use-document-visible';
import {
  collectRelevantFieldIds,
  useFieldAwareTableListener,
} from '../../hooks/use-field-aware-table-listener';
import type { CalendarView } from '../../model';
import { AnchorContext } from '../anchor';
import { ShareViewContext } from '../table/ShareViewContext';
import { CalendarDailyCollectionContext } from './CalendarDailyCollectionContext';

interface ICalendarDailyCollectionProviderProps {
  children: ReactNode;
  query?: ICalendarDailyCollectionRo;
}

const THROTTLE_TIME = 2000;

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
  const visible = useDocumentVisible();
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

  const commonQueryKey = useMemo(
    () => ReactQueryKeys.calendarDailyCollection(tableId as string, calenderDailyCollectionQuery),
    [tableId, calenderDailyCollectionQuery]
  );

  const shareQueryKey = useMemo(
    () =>
      ReactQueryKeys.shareCalendarDailyCollection(shareId as string, calenderDailyCollectionQuery),
    [shareId, calenderDailyCollectionQuery]
  );

  const { data: commonCalendarDailyCollection } = useQuery({
    queryKey: commonQueryKey,
    queryFn: ({ queryKey }) =>
      getCalendarDailyCollection(queryKey[1], queryKey[2]).then(({ data }) => data),
    enabled: Boolean(!shareId && tableId && isHydrated && isEnabled && visible),
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const { data: shareCalendarDailyCollection } = useQuery({
    queryKey: shareQueryKey,
    queryFn: ({ queryKey }) =>
      getShareViewCalendarDailyCollection(queryKey[1], queryKey[2]).then(({ data }) => data),
    enabled: Boolean(shareId && tableId && isHydrated && isEnabled && visible),
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const resCalendarDailyCollection = shareId
    ? shareCalendarDailyCollection
    : commonCalendarDailyCollection;

  const activeQueryKey = shareId ? shareQueryKey : commonQueryKey;

  const updateCalendarDailyCollection = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: activeQueryKey.slice(0, 3),
      }),
    [queryClient, activeQueryKey]
  );

  const throttleUpdateCalendarDailyCollection = useMemo(() => {
    return throttle(updateCalendarDailyCollection, THROTTLE_TIME);
  }, [updateCalendarDailyCollection]);

  const updateCalendarDailyCollectionForTable = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: activeQueryKey.slice(0, 2),
    });
  }, [queryClient, activeQueryKey]);

  const throttleUpdateCalendarDailyCollectionForTable = useMemo(() => {
    return throttle(updateCalendarDailyCollectionForTable, THROTTLE_TIME);
  }, [updateCalendarDailyCollectionForTable]);

  const ignoreViewQuery = calenderDailyCollectionQuery?.ignoreViewQuery ?? false;

  const relevantFieldIds = useMemo(
    () =>
      collectRelevantFieldIds({
        queryFilter: calenderDailyCollectionQuery.filter as IFilter | undefined,
        viewFilter: ignoreViewQuery ? undefined : (view?.filter as IFilter | undefined),
        search: calenderDailyCollectionQuery.search,
        extraFieldIds: [
          calenderDailyCollectionQuery.startDateFieldId,
          calenderDailyCollectionQuery.endDateFieldId,
        ].filter(Boolean),
      }),
    [calenderDailyCollectionQuery, view?.filter, ignoreViewQuery]
  );

  const tableMatches = useMemo<ITableActionKey[]>(
    () => ['setRecord', 'addRecord', 'deleteRecord'],
    []
  );
  useFieldAwareTableListener(
    tableId,
    tableMatches,
    relevantFieldIds,
    throttleUpdateCalendarDailyCollectionForTable
  );

  const viewMatches = useMemo<IViewActionKey[]>(() => ['applyViewFilter'], []);
  useViewListener(viewId, viewMatches, throttleUpdateCalendarDailyCollection);

  const calendarDailyCollection = useMemo(
    () => resCalendarDailyCollection || null,
    [resCalendarDailyCollection]
  );

  useEffect(() => {
    return () => {
      queryClient.removeQueries({ queryKey: activeQueryKey });
    };
  }, [queryClient, activeQueryKey]);

  return (
    <CalendarDailyCollectionContext.Provider value={calendarDailyCollection}>
      {children}
    </CalendarDailyCollectionContext.Provider>
  );
};
