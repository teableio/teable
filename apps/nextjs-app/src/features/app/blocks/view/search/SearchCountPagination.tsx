import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronRight, ChevronLeft } from '@teable/icons';
import type { ISearchIndexByQueryRo, ISearchIndexVo } from '@teable/openapi';
import {
  getSearchCellCount,
  getSearchIndex,
  getSearchMatches,
  getShareViewSearchCellCount,
  getShareViewSearchIndex,
  getShareViewSearchMatches,
} from '@teable/openapi';
import { type GridView } from '@teable/sdk';
import {
  useTableId,
  useView,
  useFields,
  useSearch,
  usePersonalView,
  useTableListener,
} from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { pick, throttle } from 'lodash';
import {
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { useGridSearchStore } from '../grid/useGridSearchStore';
import type { ISearchButtonProps } from './SearchButton';

enum PageDirection {
  Next = 1,
  Prev = -1,
}

type ISearchMap = Record<number, NonNullable<ISearchIndexVo>[number]>;

const PaginationBuffer = 100;

type ISearchCountPaginationProps = Pick<ISearchButtonProps, 'shareView'>;

export interface ISearchCountPaginationRef {
  nextIndex: () => void;
  prevIndex: () => void;
}

interface PageData {
  data: NonNullable<ISearchIndexVo>;
  nextCursor: number | null;
}

export const SearchCountPagination = forwardRef<
  ISearchCountPaginationRef,
  ISearchCountPaginationProps
>((props: ISearchCountPaginationProps, ref) => {
  const { shareView } = props;
  const { value, searchQuery, hideNotMatchRow } = useSearch();
  const tableId = useTableId();
  const view = useView() as GridView;
  const fields = useFields();
  const [currentIndex, setCurrentIndex] = useState(1);
  const { gridRef, setSearchCursor } = useGridSearchStore();
  const { isPersonalView, personalViewCommonQuery } = usePersonalView();
  // hit to re-focus after a record-change refetch, so the cursor stays on the
  // same cell instead of resetting to the first hit
  const pendingAnchorRef = useRef<{ recordId: string; fieldId: string } | null>(null);

  const searchProjection = useMemo(
    () => (shareView ? fields.map(({ id }) => id) : personalViewCommonQuery?.projection),
    [fields, personalViewCommonQuery?.projection, shareView]
  );
  const visibleSearchFieldIds = useMemo(
    () => (shareView ? new Set(searchProjection) : undefined),
    [searchProjection, shareView]
  );
  const searchViewCondition = view ? pick(view, ['sort', 'filter', 'group', 'columnMeta']) : {};
  const searchScopeKey = JSON.stringify([
    tableId,
    hideNotMatchRow,
    view?.id,
    searchQuery,
    searchViewCondition,
    searchProjection,
    personalViewCommonQuery,
  ]);
  const searchScopeRef = useRef(searchScopeKey);
  searchScopeRef.current = searchScopeKey;

  useImperativeHandle(ref, () => ({
    nextIndex: () => {
      switchIndex(PageDirection.Next);
    },
    prevIndex: () => {
      switchIndex(PageDirection.Prev);
    },
  }));

  const viewOrderBy = useMemo(() => {
    return view?.sort?.manualSort === undefined || view?.sort?.manualSort === false
      ? view?.sort?.sortObjs
      : undefined;
  }, [view]);

  const setIndexSelection = useCallback(
    (row: number, cellColumnId: string) => {
      const index = fields.findIndex((f) => f.id === cellColumnId);
      setSearchCursor([index, row - 1]);
      gridRef?.current?.scrollToItem([index, row - 1]);
    },
    [fields, gridRef, setSearchCursor]
  );

  const queryFn = async ({ pageParam = 0 }) => {
    if (pageParam === null) return { data: [], nextCursor: null };
    const baseQueryRo: ISearchIndexByQueryRo = {
      skip: pageParam,
      take: PaginationBuffer,
      viewId: view?.id,
      orderBy: viewOrderBy,
      search: searchQuery,
      groupBy: view.group,
      ...personalViewCommonQuery,
      filter: isPersonalView
        ? personalViewCommonQuery?.filter
        : (personalViewCommonQuery?.filter ?? view.filter),
      ...(!hideNotMatchRow && { projection: searchProjection }),
    };

    if (hideNotMatchRow) {
      const result = shareView
        ? await getShareViewSearchIndex(view.shareId!, baseQueryRo)
        : await getSearchIndex(tableId!, baseQueryRo);
      const hits = Array.isArray(result.data) ? result.data : [];
      const rows = new Set(hits.map((hit) => hit.recordId)).size;
      const navigableHits = shareView
        ? hits.filter(({ fieldId }) => visibleSearchFieldIds?.has(fieldId))
        : hits;
      return {
        data: navigableHits,
        nextCursor: rows === PaginationBuffer ? pageParam + rows : null,
      };
    }

    const searchFn = shareView
      ? (params: ISearchIndexByQueryRo) => getShareViewSearchMatches(view.shareId!, params)
      : (params: ISearchIndexByQueryRo) => getSearchMatches(tableId!, params);

    const { data } = await searchFn(baseQueryRo);
    return { data: data.matches, nextCursor: data.nextSkip } as PageData;
  };

  const { data, isFetching, isLoading, isError, fetchNextPage, refetch } = useInfiniteQuery({
    queryKey: ['search_index', shareView, searchScopeKey],
    queryFn,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: 'always',
    enabled: !!value,
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      return lastPage.nextCursor;
    },
  });
  const { data: countData, refetch: refetchCount } = useQuery({
    queryKey: ['search_cell_count', shareView, searchScopeKey],
    queryFn: async () => {
      const filter = isPersonalView
        ? personalViewCommonQuery?.filter
        : (personalViewCommonQuery?.filter ?? view.filter);
      const projection = searchProjection;
      const response = shareView
        ? await getShareViewSearchCellCount(view.shareId!, {
            search: searchQuery,
            filter,
            projection,
          })
        : await getSearchCellCount(tableId!, {
            viewId: view.id,
            search: searchQuery,
            filter,
            projection,
            ignoreViewQuery: personalViewCommonQuery?.ignoreViewQuery,
          });
      return response.data;
    },
    enabled: Boolean(value && tableId && view && !hideNotMatchRow),
    refetchOnWindowFocus: false,
  });
  const lastPage = data?.pages.at(-1);
  const isEnd = lastPage != null && lastPage.nextCursor == null;

  const allSearchResults = useMemo(() => {
    const finalResult: ISearchMap = {};
    const result = data?.pages.flatMap((page) => page.data) ?? [];
    result.forEach((result, index) => {
      const indexNumber = index + 1;
      finalResult[indexNumber] = result;
    });
    return finalResult;
  }, [data?.pages]);

  // mirror of the focused hit so the debounced refetch reads the latest value
  const currentHitRef = useRef<NonNullable<ISearchIndexVo>[number] | undefined>(undefined);
  currentHitRef.current = allSearchResults[currentIndex];

  const switchIndex = (direction: PageDirection) => {
    const newIndex = currentIndex + direction;
    if (isFetching || isLoading) {
      return;
    }
    pendingAnchorRef.current = null;
    if (newIndex < 1) {
      setCurrentIndex(1);
      return;
    }
    if (Object.values(allSearchResults).length === 0) {
      if (isError) {
        void refetch();
      } else if (!isEnd) {
        void fetchNextPage();
      }
      return;
    }
    if (newIndex > Object.values(allSearchResults)?.length && !isEnd) {
      const scope = searchScopeKey;
      void (async () => {
        let result = await fetchNextPage();
        while (scope === searchScopeRef.current && !result.isError) {
          const pages = result.data?.pages ?? [];
          if (pages.reduce((sum, page) => sum + page.data.length, 0) >= newIndex) {
            setCurrentIndex(newIndex);
            return;
          }
          if (pages.at(-1)?.nextCursor == null) return;
          result = await fetchNextPage();
        }
      })();
      return;
    }
    if (newIndex > Object.values(allSearchResults)?.length && isEnd) {
      return;
    }

    setCurrentIndex(newIndex);
  };

  useEffect(() => {
    pendingAnchorRef.current = null;
    setCurrentIndex(1);
    setSearchCursor(null);
  }, [searchScopeKey, setSearchCursor]);
  useEffect(() => {
    const anchor = pendingAnchorRef.current;
    if (anchor) {
      pendingAnchorRef.current = null;
      const anchorEntry = Object.entries(allSearchResults).find(
        ([, hit]) => hit.recordId === anchor.recordId && hit.fieldId === anchor.fieldId
      );
      const anchorIndex = anchorEntry ? Number(anchorEntry[0]) : 1;
      if (anchorIndex !== currentIndex) {
        setCurrentIndex(anchorIndex);
        return;
      }
    }

    const currentHit = allSearchResults?.[currentIndex];
    if (currentHit) {
      setIndexSelection(currentHit.index, currentHit.fieldId);
    } else {
      setSearchCursor(null);
    }
  }, [currentIndex, allSearchResults, setIndexSelection, setSearchCursor]);

  useEffect(() => {
    if (
      value &&
      data &&
      !isFetching &&
      !isError &&
      !isEnd &&
      !Object.keys(allSearchResults).length
    ) {
      void fetchNextPage();
    }
  }, [value, data, isFetching, isError, isEnd, allSearchResults, fetchNextPage]);

  // any record change can alter the hit list; the server list is the single
  // source of truth, so just refetch (throttled) and let the anchor keep the
  // focused cell stable across the reload
  const throttledRefetch = useMemo(
    () =>
      throttle(() => {
        const currentHit = currentHitRef.current;
        pendingAnchorRef.current = currentHit ? pick(currentHit, ['recordId', 'fieldId']) : null;
        refetch();
        if (!hideNotMatchRow) refetchCount();
      }, 1000),
    [hideNotMatchRow, refetch, refetchCount]
  );

  useEffect(() => () => throttledRefetch.cancel(), [throttledRefetch]);

  useTableListener(
    tableId,
    ['setRecord', 'addRecord', 'deleteRecord', 'addField', 'setField', 'deleteField'],
    () => {
      if (value) throttledRefetch();
    }
  );

  return (
    value &&
    (isLoading ? (
      <Spin className="size-3 shrink-0" />
    ) : (
      <div className="flex flex-1 shrink-0 items-center gap-0.5 p-0">
        {!hideNotMatchRow && (
          <span className="min-w-8 whitespace-nowrap text-xs tabular-nums" aria-live="polite">
            {allSearchResults[currentIndex] ? currentIndex : 0}/{countData?.matchedCellCount ?? '–'}
          </span>
        )}
        {isFetching && <Spin className="size-3 shrink-0" />}
        <Button
          size={'xs'}
          variant={'ghost'}
          onClick={() => {
            switchIndex(PageDirection.Prev);
          }}
          className="size-5 p-0"
          disabled={isFetching || currentIndex === 1}
        >
          <ChevronLeft className="size-4 shrink-0" />
        </Button>

        <Button
          size={'xs'}
          variant={'ghost'}
          onClick={() => {
            switchIndex(PageDirection.Next);
          }}
          className="size-5 p-0"
          disabled={
            isFetching ||
            (currentIndex === Object.values(allSearchResults).length && isEnd) ||
            (Object.values(allSearchResults).length === 0 && isEnd)
          }
        >
          <ChevronRight className="size-4 shrink-0" />
        </Button>
      </div>
    ))
  );
});

SearchCountPagination.displayName = 'SearchCountPagination';
