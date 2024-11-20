import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ChevronLeft } from '@teable/icons';
import type { ISearchIndexByQueryRo, ISearchIndexVo } from '@teable/openapi';
import {
  getSearchCount,
  getSearchIndex,
  getShareViewSearchCount,
  getShareViewSearchIndex,
} from '@teable/openapi';
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
const PaginationGap = 100;

type ISearchCountPaginationProps = Pick<ISearchButtonProps, 'shareView'>;

export interface ISearchCountPaginationRef {
  nextIndex: () => void;
  prevIndex: () => void;
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
  const [currentPage, setCurrentPage] = useState(0);
  const { gridRef, setSearchCursor } = useGridSearchStore();

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

  const { data: searchCountData, isLoading: countLoading } = useQuery({
    queryKey: [
      'search_count',
      tableId,
      value,
      JSON.stringify(view?.filter),
      JSON.stringify(searchQuery),
    ],
    queryFn: async () => {
      const queryRo = {
        search: searchQuery,
        filter: view?.filter,
        viewId: view?.id,
      };
      return shareView && view?.shareId
        ? await getShareViewSearchCount(view.shareId!, queryRo).then(({ data }) => data)
        : await getSearchCount(tableId!, queryRo).then(({ data }) => data);
    },
    enabled: Boolean(tableId && value),
    refetchOnWindowFocus: false,
  });

  const totalCount = searchCountData?.count ?? 0;

  const {
    data: indexData,
    isLoading: indexLoading,
    isFetching: indexFetching,
    refetch,
  } = useQuery({
    queryKey: [
      'search_index',
      tableId,
      value,
      JSON.stringify(view?.filter),
      JSON.stringify(searchQuery),
    ],
    queryFn: async () => {
      setSearchCursor(null);
      const nextMap = await getNextIndex();
      if (totalCount <= PaginationBuffer) {
        return nextMap;
      }
      const preMap = await getPreviousIndex();
      return {
        ...preMap,
        ...nextMap,
      };
    },
    enabled: Boolean(tableId && value && currentPage !== 0),
    refetchOnWindowFocus: false,
  });

  const getPreviousIndex = async () => {
    const finalResult: ISearchMap = {};
    let skip = 0;
    const previousCursor = currentPage - PaginationBuffer - 1;
    if (previousCursor === 0) {
      skip = totalCount - PaginationBuffer;
    }
    if (previousCursor > 0) {
      skip = currentPage - PaginationBuffer;
    }
    const baseQueryRo = {
      skip: skip,
      take: PaginationBuffer,
      viewId: view?.id,
      orderBy: viewOrderBy,
      search: searchQuery,
      groupBy: view.group,
      filter: view.filter,
    };

    const previousFn = shareView
      ? (baseQueryRo: ISearchIndexByQueryRo) => getShareViewSearchIndex(view.shareId!, baseQueryRo)
      : (baseQueryRo: ISearchIndexByQueryRo) => getSearchIndex(tableId!, baseQueryRo);

    if (previousCursor < 0) {
      const preSkip = previousCursor + totalCount;
      const [preResult, nextResult] = await Promise.all([
        previousFn({ ...baseQueryRo, skip: preSkip }),
        previousFn({ ...baseQueryRo }),
      ]);
      preResult?.data &&
        preResult?.data?.forEach((result, index) => {
          const indexNumber = preSkip + index + 1;
          finalResult[indexNumber] = result;
        });

      nextResult?.data &&
        nextResult.data?.forEach((result, index) => {
          const indexNumber = index + 1;
          finalResult[indexNumber] = result;
        });
      return finalResult;
    } else {
      const result = await previousFn(baseQueryRo);
      result?.data &&
        result.data?.forEach((result, index) => {
          const indexNumber = skip + index + 1;
          finalResult[indexNumber] = result;
        });
      return finalResult;
    }
  };

  const getNextIndex = async () => {
    const finalResult: ISearchMap = {};
    const baseQueryRo = {
      take: PaginationBuffer,
      viewId: view?.id,
      orderBy: viewOrderBy,
      search: searchQuery,
      groupBy: view.group,
      filter: view.filter,
    };
    const nextCursor = currentPage + PaginationBuffer - 1;
    const nextFn = shareView
      ? (baseQueryRo: ISearchIndexByQueryRo) => getShareViewSearchIndex(view.shareId!, baseQueryRo)
      : (baseQueryRo: ISearchIndexByQueryRo) => getSearchIndex(tableId!, baseQueryRo);
    if (nextCursor <= totalCount) {
      const skip = currentPage - 1;
      const result = await nextFn({ ...baseQueryRo, skip });
      result?.data &&
        result.data?.forEach((result, index) => {
          const indexNumber = skip + index + 1;
          finalResult[indexNumber] = result;
        });
      return finalResult;
    } else {
      const preSkip = currentPage - 1;
      const [preResult, nextResult] = await Promise.all([
        nextFn({ ...baseQueryRo, skip: preSkip }),
        nextFn({ ...baseQueryRo }),
      ]);

      preResult?.data &&
        preResult?.data?.forEach((result, index) => {
          const indexNumber = preSkip + index + 1;
          finalResult[indexNumber] = result;
        });
      nextResult?.data &&
        nextResult.data?.forEach((result, index) => {
          const indexNumber = index + 1;
          finalResult[indexNumber] = result;
        });
      return finalResult;
    }
  };

  useEffect(() => {
    if (currentPage && indexData?.[currentPage]) {
      const index = indexData?.[currentPage];
      index && setIndexSelection(index.index, index.fieldId);
    }
  }, [currentPage, indexData, setIndexSelection]);

  useEffect(() => {
    if (totalCount) {
      setCurrentPage(1);
      return;
    }

    setCurrentPage(0);
  }, [totalCount]);

  // refetch the index window
  useEffect(() => {
    if (!indexData || totalCount <= PaginationBuffer || indexFetching) return;
    const nextAnchor = ((currentPage + totalCount + PaginationGap - 1) % totalCount) + 1;
    const prevAnchor = ((currentPage + totalCount - PaginationGap - 1) % totalCount) + 1;

    if (!indexData[nextAnchor] || !indexData[prevAnchor]) {
      refetch();
    }
  }, [currentPage, indexData, indexFetching, refetch, totalCount]);

  const switchIndex = (direction: PageDirection) => {
    const newIndex = ((currentPage - 1 + direction + totalCount) % totalCount) + 1;
    if (
      !totalCount ||
      totalCount === 1 ||
      countLoading ||
      (indexFetching && !indexData?.[newIndex])
    ) {
      return;
    }
    setCurrentPage(newIndex);
  };

  return (
    value &&
    (countLoading || (currentPage !== 0 && indexLoading) ? (
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
          disabled={!totalCount}
        >
          <ChevronLeft />
        </Button>
        <span className="pointer-events-none whitespace-nowrap">
          {currentPage} / {totalCount}
        </span>
        <Button
          size={'xs'}
          variant={'ghost'}
          onClick={() => {
            switchIndex(PageDirection.Next);
          }}
          disabled={!totalCount}
          className="size-5 p-0"
        >
          <ChevronRight />
        </Button>
      </div>
    ))
  );
});

SearchCountPagination.displayName = 'SearchCountPagination';
