import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronRight, ChevronLeft } from '@teable/icons';
import type { ISearchIndexByQueryRo, ISearchIndexVo } from '@teable/openapi';
import { getSearchIndex, getShareViewSearchIndex } from '@teable/openapi';
import { type GridView } from '@teable/sdk';
import { useTableId, useView, useFields, useSearch } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { useEffect, useState, forwardRef, useImperativeHandle, useCallback, useMemo } from 'react';
import { useGridSearchStore } from '../grid/useGridSearchStore';
import type { ISearchButtonProps } from './SearchButton';

enum PageDirection {
  Next = 1,
  Prev = -1,
}

type ISearchMap = Record<number, NonNullable<ISearchIndexVo>[number]>;

const PaginationBuffer = 300;

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
  const { gridRef, setSearchCursor } = useGridSearchStore();
  const [isEnd, setIsEnd] = useState(false);

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
    const baseQueryRo: ISearchIndexByQueryRo = {
      skip: pageParam,
      take: PaginationBuffer,
      viewId: view?.id,
      orderBy: viewOrderBy,
      search: searchQuery,
      groupBy: view.group,
      filter: view.filter,
    };

    const searchFn = shareView
      ? (params: ISearchIndexByQueryRo) => getShareViewSearchIndex(view.shareId!, params)
      : (params: ISearchIndexByQueryRo) => getSearchIndex(tableId!, params);

    const result = await searchFn(baseQueryRo);

    if (!result || pageParam === null) {
      setIsEnd(true);
      return {
        data: [],
        nextCursor: null,
      };
    }

    const nextCursor =
      result.data?.length ?? 0 >= PaginationBuffer ? pageParam + PaginationBuffer : null;

    const dataLength = Object.values(allSearchResults).length;

    if (currentIndex === dataLength && dataLength !== 0 && result?.data?.length !== 0) {
      setCurrentIndex(currentIndex + PageDirection.Next);
    }

    return {
      data: result.data || [],
      nextCursor,
    } as PageData;
  };

  const { data, isFetching, isLoading, fetchNextPage } = useInfiniteQuery({
    queryKey: [
      'search_index',
      tableId,
      value,
      JSON.stringify(view?.filter),
      JSON.stringify(searchQuery),
    ],
    queryFn,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    enabled: !!value,
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
  }, [data]);

  const switchIndex = (direction: PageDirection) => {
    const newIndex = currentIndex + direction;
    if (newIndex < 1) {
      setCurrentIndex(1);
      return;
    }
    if (newIndex > Object.values(allSearchResults)?.length && !isEnd) {
      fetchNextPage();
      return;
    }
    if (newIndex > Object.values(allSearchResults)?.length && isEnd) {
      return;
    }

    setCurrentIndex(newIndex);
  };

  useEffect(() => {
    if (allSearchResults?.[currentIndex]) {
      const index = allSearchResults?.[currentIndex];
      index && setIndexSelection(index.index, index.fieldId);
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
        >
          <ChevronLeft />
        </Button>

        <Button
          size={'xs'}
          variant={'ghost'}
          onClick={() => {
            switchIndex(PageDirection.Next);
          }}
          className="size-5 p-0"
        >
          <ChevronRight />
        </Button>
      </div>
    ))
  );
});

SearchCountPagination.displayName = 'SearchCountPagination';
