import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, Outlet, useMatch, useNavigate } from '@tanstack/react-router';
import { TableByNameLikeSpec, TableName } from '@teable/v2-core';
import {
  mapTableDtoToDomain,
  type IListTablesOkResponseDto,
  type ITableDto,
} from '@teable/v2-contract-http';
import { tableTemplates, type TableTemplateDefinition } from '@teable/v2-table-templates';
import { Database, RefreshCcw, Table as TableIcon, TriangleAlert } from 'lucide-react';
import { debounce, useQueryState } from 'nuqs';
import { useEffect, useOptimistic, useState } from 'react';
import { toast } from 'sonner';
import { useDebounceValue, useLocalStorage } from 'usehooks-ts';

import { CreateTableDropdown } from '@/components/playground/CreateTableDropdown';
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
import { RemoteOrpcProvider } from '@/lib/orpc/RemoteOrpcProvider';
import { useOrpcClient } from '@/lib/orpc/OrpcClientContext';
import { resolveBaseName, usePlaygroundEnvironment } from '@/lib/playground/environment';

export const Route = createFileRoute('/$baseId')({ component: PlaygroundBaseRoute });

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

function PlaygroundBaseRoute() {
  const { baseId } = Route.useParams();
  return (
    <RemoteOrpcProvider>
      <PlaygroundBaseLayout baseId={baseId} />
    </RemoteOrpcProvider>
  );
}

type PlaygroundBaseLayoutProps = {
  baseId: string;
};

export function PlaygroundBaseLayout({ baseId }: PlaygroundBaseLayoutProps) {
  const env = usePlaygroundEnvironment();
  const tableMatch = useMatch({ from: env.routes.table, shouldThrow: false });
  const activeTableId = tableMatch?.params.tableId ?? null;
  const baseName = resolveBaseName(env, baseId);
  const [storedBaseId, setStoredBaseId] = useLocalStorage<string | null>(
    env.storageKeys.baseId,
    null,
    { initializeWithValue: false }
  );
  const [storedTableId, setStoredTableId, removeStoredTableId] = useLocalStorage<string | null>(
    env.storageKeys.tableId,
    null,
    { initializeWithValue: false }
  );

  const [search, setSearch] = useQueryState('q', {
    limitUrlUpdates: debounce(300),
  });
  const [debouncedSearch] = useDebounceValue(search, 300);
  const searchValue = search ?? '';
  const trimmedSearch = searchValue.trim();
  const hasSearch = trimmedSearch.length > 0;
  const searchQuery = debouncedSearch?.trim() ?? '';
  const isSearchSynced = trimmedSearch === searchQuery;

  const orpc = createTanstackQueryUtils(useOrpcClient());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const tablesQuery = useQuery<IListTablesOkResponseDto, unknown, ReadonlyArray<ITableDto>>(
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

  useEffect(() => {
    if (storedBaseId !== baseId) {
      setStoredBaseId(baseId);
      if (!activeTableId) {
        removeStoredTableId();
      }
    }
  }, [activeTableId, baseId, removeStoredTableId, setStoredBaseId, storedBaseId]);

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
        setStoredBaseId(baseId);
        setStoredTableId(created.id);
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
          to: env.routes.table,
          params: { baseId, tableId: created.id },
        });
      },
    })
  );

  const deleteTableMutation = useMutation(
    orpc.tables.delete.mutationOptions({
      onSuccess: (_response, variables) => {
        const deletedId = variables.tableId;

        queryClient.removeQueries({
          queryKey: orpc.tables.getById.queryKey({
            input: {
              baseId,
              tableId: deletedId,
            },
          }),
        });

        const removeFromList = (list: IListTablesOkResponseDto | undefined) =>
          list
            ? {
                ...list,
                data: {
                  ...list.data,
                  tables: list.data.tables.filter((table) => table.id !== deletedId),
                },
              }
            : list;

        queryClient.setQueryData(orpc.tables.list.queryKey({ input: { baseId } }), removeFromList);

        if (searchQuery) {
          queryClient.setQueryData(
            orpc.tables.list.queryKey({ input: { baseId, q: searchQuery } }),
            removeFromList
          );
        }

        if (storedBaseId === baseId && storedTableId === deletedId) {
          removeStoredTableId();
        }

        if (activeTableId === deletedId) {
          void navigate({ to: env.routes.base, params: { baseId } });
        }

        void queryClient.invalidateQueries({
          queryKey: orpc.tables.list.queryKey({ input: { baseId } }),
          exact: false,
        });
      },
      onError: (error) => {
        toast.error(getErrorMessage(error, 'Failed to delete table'));
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

  const handleCreateTemplate = (template: TableTemplateDefinition) => {
    createTableMutation.reset();
    createTableMutation.mutate(template.createInput(baseId, template.name));
  };

  const handleDeleteTable = (table: ITableDto) => {
    deleteTableMutation.reset();
    deleteTableMutation.mutate({ baseId, tableId: table.id });
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
      onDeleteTable={handleDeleteTable}
      isDeletingTable={deleteTableMutation.isPending}
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
          templates={tableTemplates}
          onCreateTemplate={handleCreateTemplate}
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
  templates: ReadonlyArray<TableTemplateDefinition>;
  onCreateTemplate: (template: TableTemplateDefinition) => void;
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
  templates,
  onCreateTemplate,
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
        templates={templates}
        onCreateTemplate={onCreateTemplate}
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
            templates={templates}
            onCreateTemplate={onCreateTemplate}
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
  templates: ReadonlyArray<TableTemplateDefinition>;
  onCreateTemplate: (template: TableTemplateDefinition) => void;
};

function PlaygroundBaseHeader({
  baseName,
  tableCount,
  isLoading,
  isCreating,
  onRefresh,
  templates,
  onCreateTemplate,
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
        <CreateTableDropdown
          templates={templates}
          isCreating={isCreating}
          onSelect={onCreateTemplate}
          label="Create table"
          align="end"
        />
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
  const env = usePlaygroundEnvironment();
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
                    to={env.routes.table}
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
                      to={env.routes.table}
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
  templates: ReadonlyArray<TableTemplateDefinition>;
  onCreateTemplate: (template: TableTemplateDefinition) => void;
};

function PlaygroundBaseEmptyState({
  hasSearch,
  searchValue,
  isCreating,
  templates,
  onCreateTemplate,
}: PlaygroundBaseEmptyStateProps) {
  const title = hasSearch ? 'No matching tables' : 'Create your first table';
  const description = hasSearch
    ? `No tables match "${searchValue}".`
    : 'Pick a template to explore the v2 playground with different field mixes.';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>{description}</p>
        <CreateTableDropdown
          templates={templates}
          isCreating={isCreating}
          onSelect={onCreateTemplate}
          label="Create table"
          align="start"
        />
      </CardContent>
    </Card>
  );
}
