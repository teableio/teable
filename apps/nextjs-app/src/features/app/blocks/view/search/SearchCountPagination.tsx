import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronRight, ChevronLeft } from '@teable/icons';
import type { ISearchIndexByQueryRo, ISearchIndexVo } from '@teable/openapi';
import { getSearchIndex, getShareViewSearchIndex } from '@teable/openapi';
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
import { isEmpty, pick, throttle } from 'lodash';
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
  const { value, searchQuery } = useSearch();
  const tableId = useTableId();
  const view = useView() as GridView;
  const fields = useFields();
  const [currentIndex, setCurrentIndex] = useState(1);
  const { gridRef, setSearchCursor, recordMap } = useGridSearchStore();
  const { personalViewCommonQuery } = usePersonalView();
  const [isEnd, setIsEnd] = useState(false);
  // hit to re-focus after a record-change refetch, so the cursor stays on the
  // same cell instead of resetting to the first hit
  const pendingAnchorRef = useRef<{ recordId: string; fieldId: string } | null>(null);

  const searchViewCondition = useMemo(() => {
    return view ? pick(view, ['sort', 'filter', 'group', 'columnMeta']) : {};
  }, [view]);

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
    const skipLength = new Set(
      Object.values(allSearchResults).map((rec) => rec.recordId) as string[]
    ).size as number;

    const baseQueryRo: ISearchIndexByQueryRo = {
      skip: pageParam,
      take: PaginationBuffer,
      viewId: view?.id,
      orderBy: viewOrderBy,
      search: searchQuery,
      groupBy: view.group,
      filter: view.filter,
      ...personalViewCommonQuery,
    };

    const searchFn = shareView
      ? (params: ISearchIndexByQueryRo) => getShareViewSearchIndex(view.shareId!, params)
      : (params: ISearchIndexByQueryRo) => getSearchIndex(tableId!, params);

    const result = await searchFn(baseQueryRo);

    if (!result?.data || pageParam === null) {
      setIsEnd(true);
      return {
        data: [],
        nextCursor: null,
      };
    }

    const nextCursor =
      result.data?.length ?? 0 >= PaginationBuffer ? skipLength + PaginationBuffer : null;

    return {
      data: result.data || [],
      nextCursor,
    } as PageData;
  };

  const { data, isFetching, isLoading, fetchNextPage, refetch } = useInfiniteQuery({
    queryKey: [
      'search_index',
      tableId,
      value,
      JSON.stringify(searchViewCondition),
      JSON.stringify(searchQuery),
      JSON.stringify(personalViewCommonQuery),
    ],
    queryFn,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    enabled: !!value,
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      return lastPage.nextCursor;
    },
  });

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
    if (newIndex < 1) {
      setCurrentIndex(1);
      return;
    }
    if (Object.values(allSearchResults)?.length === 0) {
      return;
    }
    if (newIndex > Object.values(allSearchResults)?.length && !isEnd) {
      fetchNextPage().then((result) => {
        const total = result.data?.pages.flatMap((page) => page.data).length ?? 0;
        if (newIndex <= total) {
          setCurrentIndex(newIndex);
        }
      });
      return;
    }
    if (newIndex > Object.values(allSearchResults)?.length && isEnd) {
      return;
    }

    setCurrentIndex(newIndex);
  };

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
    if (value) {
      setIsEnd(false);
      setCurrentIndex(1);
    }
  }, [setSearchCursor, value]);

  // any record change can alter the hit list; the server list is the single
  // source of truth, so just refetch (throttled) and let the anchor keep the
  // focused cell stable across the reload
  const throttledRefetch = useMemo(
    () =>
      throttle(() => {
        const currentHit = currentHitRef.current;
        pendingAnchorRef.current = currentHit ? pick(currentHit, ['recordId', 'fieldId']) : null;
        refetch();
      }, 1000),
    [refetch]
  );

  useEffect(() => () => throttledRefetch.cancel(), [throttledRefetch]);

  useTableListener(tableId, ['setRecord', 'addRecord', 'deleteRecord'], () => {
    if (!value || isEmpty(allSearchResults) || !recordMap || isLoading || isFetching) {
      return;
    }

    if (allSearchResults?.[currentIndex]) {
      const { fieldId, index: recordIndex } = allSearchResults[currentIndex];
      const field = fields.find(({ id }) => id === fieldId);
      const cellValue = recordMap?.[recordIndex - 1]?.getCellValue(fieldId);
      // same substring semantics as server-side searching and grid highlighting
      if (field && !field.matchSearch(cellValue, value)) {
        throttledRefetch();
      }
    }
  });

  return (
    value &&
    (isFetching || isLoading ? (
      <Spin className="size-3 shrink-0" />
    ) : (
      <div className="flex flex-1 shrink-0 items-center gap-0.5 p-0">
        <Button
          size={'xs'}
          variant={'ghost'}
          onClick={() => {
            switchIndex(PageDirection.Prev);
          }}
          className="size-5 p-0"
          disabled={currentIndex === 1}
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
            (currentIndex === Object.values(allSearchResults).length && isEnd) ||
            Object.values(allSearchResults).length === 0
          }
        >
          <ChevronRight className="size-4 shrink-0" />
        </Button>
      </div>
    ))
  );
});

SearchCountPagination.displayName = 'SearchCountPagination';
