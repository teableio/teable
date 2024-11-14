import { useQuery, useMutation } from '@tanstack/react-query';
import { ChevronRight, ChevronLeft } from '@teable/icons';
import type { ISearchIndexByQueryRo } from '@teable/openapi';
import {
  getSearchCount,
  getSearchIndex,
  getShareViewSearchCount,
  getShareViewSearchIndex,
} from '@teable/openapi';
import type { GridView } from '@teable/sdk';
import { CombinedSelection, SelectionRegionType } from '@teable/sdk';
import { useTableId, useView, useFields, useSearch } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { useEffect, useState } from 'react';
import { useDebounce } from 'react-use';
import { useGridSearchStore } from '../grid/useGridSearchStore';
import type { ISearchButtonProps } from './SearchButton';

enum PageDirection {
  Next = 1,
  Prev = -1,
}

type ISearchCountPaginationProps = Pick<ISearchButtonProps, 'shareView'>;

export const SearchCountPagination = (props: ISearchCountPaginationProps) => {
  const { shareView } = props;
  const { value, searchQuery } = useSearch();
  const tableId = useTableId();
  const view = useView() as GridView;
  const fields = useFields();
  const [currentPage, setCurrentPage] = useState(0);
  const { gridRef } = useGridSearchStore();

  const { mutateAsync: getOrderIndexFn } = useMutation({
    mutationFn: ({ tableId, query }: { tableId: string; query: ISearchIndexByQueryRo }) =>
      shareView
        ? getShareViewSearchIndex(view.shareId!, query).then(({ data }) => data)
        : getSearchIndex(tableId, query).then(({ data }) => data),
  });

  const setIndexSelection = (row: number, cellColumnId: string) => {
    const allFieldWithHidden = fields
      .filter((f) => !view?.columnMeta[f.id]?.hidden)
      .map((f) => ({
        ...f,
        order: view?.columnMeta[f.id]?.order ?? Number.MIN_SAFE_INTEGER,
      }))
      .sort((a, b) => a.order - b.order);
    const index = allFieldWithHidden.findIndex((f) => f.id === cellColumnId);
    const newSelectSelection = new CombinedSelection(SelectionRegionType.Cells, [
      [index, row - 1],
      [index, row - 1],
    ]);
    newSelectSelection && gridRef?.current?.setSelection(newSelectSelection);
  };

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
  });

  const totalPage = searchCountData?.count ?? 0;

  useEffect(() => {
    if (totalPage) {
      setCurrentPage(1);
      return;
    }

    setCurrentPage(0);
  }, [totalPage]);

  const switchPage = (direction: PageDirection) => {
    if (!totalPage || totalPage === 1) return;
    const newPage = ((currentPage - 1 + direction + totalPage) % totalPage) + 1;
    setCurrentPage(newPage);
  };

  useDebounce(
    () => {
      if (currentPage && tableId && view?.id) {
        const orderBy =
          view?.sort?.manualSort === undefined || view?.sort?.manualSort === false
            ? view?.sort?.sortObjs
            : undefined;
        getOrderIndexFn({
          tableId: tableId,
          query: {
            index: currentPage,
            viewId: view?.id,
            orderBy,
            search: searchQuery,
            groupBy: view.group,
          },
        }).then((data) => {
          data && setIndexSelection(data.index, data.fieldId);
        });
      }
    },
    500,
    [currentPage]
  );

  return (
    value &&
    (countLoading ? (
      <Spin className="size-3" />
    ) : (
      <div className="flex items-center gap-0.5">
        <Button
          size={'xs'}
          variant={'ghost'}
          onClick={() => {
            switchPage(PageDirection.Prev);
          }}
          className="size-5 p-0"
          disabled={!totalPage}
        >
          <ChevronLeft />
        </Button>
        <span className="pointer-events-none">
          {currentPage} / {totalPage}
        </span>
        <Button
          size={'xs'}
          variant={'ghost'}
          onClick={() => {
            switchPage(PageDirection.Next);
          }}
          disabled={!totalPage}
          className="size-5 p-0"
        >
          <ChevronRight />
        </Button>
      </div>
    ))
  );
};
