import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, Outlet, useMatch, useNavigate } from '@tanstack/react-router';
import { TableByNameLikeSpec, TableName } from '@teable/v2-core';
import { mapTableDtoToDomain, type ITableDto } from '@teable/v2-contract-http';
import { Database, Plus, RefreshCcw, Table as TableIcon, TriangleAlert } from 'lucide-react';
import { debounce, useQueryState } from 'nuqs';
import { useEffect, useOptimistic, useState } from 'react';
import { useDebounceValue } from 'usehooks-ts';

import { PlaygroundShell } from '@/components/playground/PlaygroundShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getOrpcClient } from '@/lib/orpcClient';
import { buildBasicTableInput } from '@/lib/playground/basicTable';
import {
  PLAYGROUND_BASE_ID,
  PLAYGROUND_BASE_NAME,
  PLAYGROUND_TABLE_ID_STORAGE_KEY,
} from '@/lib/playground/constants';

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
  const baseName = baseId === PLAYGROUND_BASE_ID ? PLAYGROUND_BASE_NAME : baseId;

  const [search, setSearch] = useQueryState('q', {
    limitUrlUpdates: debounce(300),
  });
  const [debouncedSearch] = useDebounceValue(search, 300);
  const searchValue = search ?? '';
  const trimmedSearch = searchValue.trim();
  const hasSearch = trimmedSearch.length > 0;
  const searchQuery = debouncedSearch?.trim() ?? '';
  const isSearchSynced = trimmedSearch === searchQuery;

  const orpc = createTanstackQueryUtils(getOrpcClient());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
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

  const listErrorMessage = tablesQuery.error
    ? getErrorMessage(tablesQuery.error, 'Failed to load tables')
    : null;
  const isInitialLoading = tablesQuery.isLoading && !hasSearch;

  const createTableMutation = useMutation(
    orpc.tables.create.mutationOptions({
      onSuccess: (response) => {
        const created = response.data.table;
        if (typeof window !== 'undefined') {
          localStorage.setItem(PLAYGROUND_TABLE_ID_STORAGE_KEY, created.id);
        }
        queryClient.setQueryData(
          orpc.tables.getById.queryKey({
            input: {
              baseId,
              tableId: created.id,
            },
          }),
          { ok: true, data: { table: created } }
        );
        void queryClient.invalidateQueries({
          queryKey: orpc.tables.list.queryKey({
            input: { baseId },
          }),
        });
        void navigate({
          to: '/$baseId/$tableId',
          params: { baseId, tableId: created.id },
        });
      },
    })
  );

  const handleSearchChange = (value: string) => {
    const nextValue = value.trim();
    void setSearch(nextValue ? nextValue : null);
  };

  const handleRefresh = () => {
    void tablesQuery.refetch();
  };

  const handleCreate = () => {
    createTableMutation.reset();
    createTableMutation.mutate(buildBasicTableInput(baseId, `Playground Table ${Date.now()}`));
  };

  const pageErrorMessage = (() => {
    if (listErrorMessage) return listErrorMessage;
    if (createTableMutation.error) {
      return getErrorMessage(createTableMutation.error, 'Failed to create table');
    }
    return null;
  })();

  return (
    <PlaygroundShell
      baseId={baseId}
      activeTableId={activeTableId}
      tables={tables}
      isInitialLoading={isInitialLoading}
      errorMessage={listErrorMessage}
      searchValue={searchValue}
      onSearchChange={handleSearchChange}
    >
      {activeTableId ? (
        <Outlet />
      ) : (
        <PlaygroundBasePage
          baseId={baseId}
          baseName={baseName}
          tables={tables}
          isInitialLoading={isInitialLoading}
          isLoading={tablesQuery.isFetching}
          isCreating={createTableMutation.isPending}
          errorMessage={pageErrorMessage}
          searchValue={searchValue}
          onRefresh={handleRefresh}
          onCreate={handleCreate}
        />
      )}
    </PlaygroundShell>
  );
}

type PlaygroundBasePageProps = {
  baseId: string;
  baseName: string;
  tables: ReadonlyArray<ITableDto>;
  isInitialLoading: boolean;
  isLoading: boolean;
  isCreating: boolean;
  errorMessage: string | null;
  searchValue: string;
  onRefresh: () => void;
  onCreate: () => void;
};

function PlaygroundBasePage({
  baseId,
  baseName,
  tables,
  isInitialLoading,
  isLoading,
  isCreating,
  errorMessage,
  searchValue,
  onRefresh,
  onCreate,
}: PlaygroundBasePageProps) {
  const trimmedSearch = searchValue.trim();
  const hasSearch = trimmedSearch.length > 0;

  return (
    <>
      <PlaygroundBaseHeader
        baseName={baseName}
        tableCount={tables.length}
        isLoading={isLoading}
        isCreating={isCreating}
        onRefresh={onRefresh}
        onCreate={onCreate}
      />
      <section className="flex-1 space-y-6 px-6 py-8">
        {errorMessage ? <PlaygroundErrorState message={errorMessage} /> : null}

        {isInitialLoading ? (
          <PlaygroundBaseLoadingState />
        ) : tables.length ? (
          <PlaygroundTablesCard baseId={baseId} tables={tables} searchValue={searchValue} />
        ) : (
          <PlaygroundBaseEmptyState
            hasSearch={hasSearch}
            searchValue={trimmedSearch}
            isCreating={isCreating}
            onCreate={onCreate}
          />
        )}
      </section>
    </>
  );
}

type PlaygroundBaseHeaderProps = {
  baseName: string;
  tableCount: number;
  isLoading: boolean;
  isCreating: boolean;
  onRefresh: () => void;
  onCreate: () => void;
};

function PlaygroundBaseHeader({
  baseName,
  tableCount,
  isLoading,
  isCreating,
  onRefresh,
  onCreate,
}: PlaygroundBaseHeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-background px-6 py-5">
      <div className="flex flex-wrap items-center gap-3">
        <SidebarTrigger className="shrink-0" />
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Base
          </div>
          <div className="text-xl font-semibold text-foreground">{baseName}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span>Postgres playground</span>
            <Badge variant="outline">{tableCount} tables</Badge>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={isLoading} onClick={onRefresh}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
        <Button disabled={isCreating} onClick={onCreate}>
          <Plus className="mr-2 h-4 w-4" />
          {isCreating ? 'Creating...' : 'Create basic table'}
        </Button>
      </div>
    </header>
  );
}

type PlaygroundErrorStateProps = {
  message: string;
};

function PlaygroundErrorState({ message }: PlaygroundErrorStateProps) {
  return (
    <Card className="border-destructive/40 bg-destructive/10">
      <CardHeader className="flex flex-row items-center gap-3">
        <TriangleAlert className="h-4 w-4 text-destructive" />
        <CardTitle className="text-base text-destructive">{message}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function PlaygroundBaseLoadingState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-base">
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={`table-row-skeleton-${index}`} className="flex items-center gap-3">
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="ml-auto h-4 w-20" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

type PlaygroundTablesCardProps = {
  baseId: string;
  tables: ReadonlyArray<ITableDto>;
  searchValue: string;
};

function PlaygroundTablesCard({ baseId, tables, searchValue }: PlaygroundTablesCardProps) {
  const search = searchValue ? { q: searchValue } : {};

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-lg">
          <TableIcon className="h-5 w-5 text-muted-foreground" />
          Tables
          <Badge variant="secondary">{tables.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <UITable>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Table ID</TableHead>
              <TableHead>Fields</TableHead>
              <TableHead className="text-right">Open</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tables.map((table) => (
              <TableRow key={table.id}>
                <TableCell className="font-medium">
                  <Link
                    to="/$baseId/$tableId"
                    params={{ baseId, tableId: table.id }}
                    search={search}
                    className="inline-flex items-center gap-2"
                  >
                    <TableIcon className="h-4 w-4 text-muted-foreground" />
                    <span>{table.name}</span>
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {table.id}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{table.fields.length}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" asChild>
                    <Link
                      to="/$baseId/$tableId"
                      params={{ baseId, tableId: table.id }}
                      search={search}
                    >
                      Open
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </UITable>
      </CardContent>
    </Card>
  );
}

type PlaygroundBaseEmptyStateProps = {
  hasSearch: boolean;
  searchValue: string;
  isCreating: boolean;
  onCreate: () => void;
};

function PlaygroundBaseEmptyState({
  hasSearch,
  searchValue,
  isCreating,
  onCreate,
}: PlaygroundBaseEmptyStateProps) {
  const title = hasSearch ? 'No matching tables' : 'Create your first table';
  const description = hasSearch
    ? `No tables match "${searchValue}".`
    : 'Build a basic table with all field types to explore the v2 playground.';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>{description}</p>
        <Button disabled={isCreating} onClick={onCreate}>
          <Plus className="mr-2 h-4 w-4" />
          {isCreating ? 'Creating...' : 'Create table'}
        </Button>
      </CardContent>
    </Card>
  );
}
