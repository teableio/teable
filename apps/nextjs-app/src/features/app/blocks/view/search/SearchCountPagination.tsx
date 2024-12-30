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
const PaginationGap = 200;

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
  const [currentIndex, setCurrentIndex] = useState(0);
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
      if (totalCount <= PaginationBuffer || currentIndex === 1) {
        return nextMap;
      }

      const preMap = await getPreviousIndex();

      return {
        ...preMap,
        ...nextMap,
      };
    },
    enabled: Boolean(tableId && value && currentIndex !== 0),
    refetchOnWindowFocus: false,
  });

  const getPreviousIndex = async () => {
    const finalResult: ISearchMap = {};
    let skip = 0;
    const previousCursor = currentIndex - PaginationBuffer - 1;
    if (previousCursor === 0) {
      skip = 0;
    }
    if (previousCursor > 0) {
      skip = currentIndex - PaginationBuffer;
    }
    const baseQueryRo = {
      skip: skip || undefined,
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

    const result = await previousFn(baseQueryRo);
    result?.data &&
      result.data?.forEach((result, index) => {
        const indexNumber = skip + index + 1;
        finalResult[indexNumber] = result;
      });
    return finalResult;
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
    const nextFn = shareView
      ? (baseQueryRo: ISearchIndexByQueryRo) => getShareViewSearchIndex(view.shareId!, baseQueryRo)
      : (baseQueryRo: ISearchIndexByQueryRo) => getSearchIndex(tableId!, baseQueryRo);

    const skip = currentIndex - 1 < 0 ? 0 : currentIndex - 1;
    const result = await nextFn({ ...baseQueryRo, skip });

    result?.data &&
      result.data?.forEach((result, index) => {
        const indexNumber = skip + index + 1;
        finalResult[indexNumber] = result;
      });
    return finalResult;
  };

  useEffect(() => {
    if (currentIndex && indexData?.[currentIndex]) {
      const index = indexData?.[currentIndex];
      index && setIndexSelection(index.index, index.fieldId);
    }
  }, [currentIndex, indexData, setIndexSelection]);

  useEffect(() => {
    if (totalCount) {
      setCurrentIndex(1);
      return;
    }

    setCurrentIndex(0);
  }, [totalCount]);

  // refetch the index window
  useEffect(() => {
    if (!indexData || totalCount <= PaginationBuffer || indexFetching) return;

    const nextAnchor =
      currentIndex + PaginationBuffer - PaginationGap >= totalCount
        ? totalCount
        : currentIndex + PaginationBuffer - PaginationGap;

    const prevAnchor =
      currentIndex - PaginationBuffer + PaginationGap <= 0
        ? 1
        : currentIndex - PaginationBuffer + PaginationGap;

    if (!indexData[nextAnchor] || !indexData[prevAnchor]) {
      refetch();
    }
  }, [currentIndex, indexData, indexFetching, refetch, totalCount]);

  const switchIndex = (direction: PageDirection) => {
    const newIndex = ((currentIndex - 1 + direction + totalCount) % totalCount) + 1;
    if (
      !totalCount ||
      totalCount === 1 ||
      countLoading ||
      (indexFetching && !indexData?.[newIndex])
    ) {
      return;
    }
    setCurrentIndex(newIndex);
  };

  return (
    value &&
    (indexFetching || countLoading || (currentIndex !== 0 && indexLoading) ? (
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
          {currentIndex} / {totalCount}
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
