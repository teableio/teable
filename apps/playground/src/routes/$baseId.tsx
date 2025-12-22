import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Outlet, useMatch } from '@tanstack/react-router';
import { TableByNameLikeSpec, TableName } from '@teable/v2-core';
import { mapTableDtoToDomain, type ITableDto } from '@teable/v2-contract-http';
import { debounce, useQueryState } from 'nuqs';
import { useEffect, useOptimistic, useState } from 'react';

import { PlaygroundShell } from '@/components/playground/PlaygroundShell';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { getOrpcClient } from '@/lib/orpcClient';

export const Route = createFileRoute('/$baseId')({ component: PlaygroundBaseLayout });

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
};

const filterTablesByNameLike = (
  tables: ReadonlyArray<ITableDto>,
  query: string
): ReadonlyArray<ITableDto> => {
  const nameResult = TableName.create(query);
  if (nameResult.isErr()) return [];
  const spec = TableByNameLikeSpec.create(nameResult.value);

  return tables.filter((table) => {
    const tableResult = mapTableDtoToDomain(table);
    if (tableResult.isErr()) return false;
    return spec.isSatisfiedBy(tableResult.value);
  });
};

function PlaygroundBaseLayout() {
  const { baseId } = Route.useParams();
  const tableMatch = useMatch({ from: '/$baseId/$tableId', shouldThrow: false });
  const activeTableId = tableMatch?.params.tableId ?? null;

  const [search, setSearch] = useQueryState('q', {
    limitUrlUpdates: debounce(300),
  });
  const debouncedSearch = useDebouncedValue(search, 300);
  const searchValue = search ?? '';
  const trimmedSearch = searchValue.trim();
  const hasSearch = trimmedSearch.length > 0;
  const searchQuery = debouncedSearch?.trim() ?? '';
  const isSearchSynced = trimmedSearch === searchQuery;

  const orpc = createTanstackQueryUtils(getOrpcClient());
  const tablesQuery = useQuery(
    orpc.tables.list.queryOptions({
      input: {
        baseId,
        ...(searchQuery ? { q: searchQuery } : {}),
      },
      select: (response) => response.data.tables,
    })
  );

  const [baseTables, setBaseTables] = useState<ReadonlyArray<ITableDto>>([]);
  const [optimisticTables, setOptimisticTables] = useOptimistic(baseTables, (_, next) => next);

  useEffect(() => {
    if (!searchQuery && tablesQuery.data) {
      setBaseTables(tablesQuery.data);
    }
  }, [searchQuery, tablesQuery.data]);

  useEffect(() => {
    if (!hasSearch) return;
    setOptimisticTables(filterTablesByNameLike(baseTables, trimmedSearch));
  }, [baseTables, hasSearch, setOptimisticTables, trimmedSearch]);

  const tables = (() => {
    if (!hasSearch) return tablesQuery.data ?? [];
    if (!isSearchSynced) return optimisticTables;
    return tablesQuery.data ?? optimisticTables;
  })();

  const errorMessage = tablesQuery.error
    ? getErrorMessage(tablesQuery.error, 'Failed to load tables')
    : null;

  const handleSearchChange = (value: string) => {
    const nextValue = value.trim();
    void setSearch(nextValue ? nextValue : null);
  };

  return (
    <PlaygroundShell
      baseId={baseId}
      activeTableId={activeTableId}
      tables={tables}
      isInitialLoading={tablesQuery.isLoading && !hasSearch}
      errorMessage={errorMessage}
      searchValue={searchValue}
      onSearchChange={handleSearchChange}
    >
      <Outlet />
    </PlaygroundShell>
  );
}
