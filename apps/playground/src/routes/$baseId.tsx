import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, Outlet, useMatch, useNavigate } from '@tanstack/react-router';
import { TableByNameLikeSpec, TableName } from '@teable/v2-core';
import {
  mapTableDtoToDomain,
  type IBaseDto,
  type IListBasesOkResponseDto,
  type IListTablesOkResponseDto,
  type ITableDto,
} from '@teable/v2-contract-http';
import { tableTemplates, type TableTemplateDefinition } from '@teable/v2-table-templates';
import { Database, RefreshCcw, Table as TableIcon, TriangleAlert } from 'lucide-react';
import { debounce, useQueryState } from 'nuqs';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useDebounceValue, useLocalStorage } from 'usehooks-ts';

import { CreateTableDropdown } from '@/components/playground/CreateTableDropdown';
import { PlaygroundShell } from '@/components/playground/PlaygroundShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { RemoteOrpcProvider } from '@/lib/orpc/RemoteOrpcProvider';
import { useOrpcClient } from '@/lib/orpc/OrpcClientContext';
import {
  PLAYGROUND_DB_CONNECTIONS_STORAGE_KEY,
  PLAYGROUND_DB_URL_STORAGE_KEY,
  findPlaygroundDbConnectionByUrl,
  resolvePlaygroundDbUrl,
  resolvePlaygroundDbStorageKey,
  type PlaygroundDbConnection,
} from '@/lib/playground/databaseUrl';
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
  const [dbUrl] = useLocalStorage<string | null>(PLAYGROUND_DB_URL_STORAGE_KEY, null, {
    initializeWithValue: false,
  });
  const [dbConnections] = useLocalStorage<PlaygroundDbConnection[]>(
    PLAYGROUND_DB_CONNECTIONS_STORAGE_KEY,
    [],
    { initializeWithValue: false }
  );
  const activeDbUrl = resolvePlaygroundDbUrl(dbUrl);
  const activeConnection = findPlaygroundDbConnectionByUrl(dbConnections, activeDbUrl);
  const baseStorageKey =
    env.kind === 'sandbox'
      ? env.storageKeys.baseId
      : resolvePlaygroundDbStorageKey(env.storageKeys.baseId, {
          connectionId: activeConnection?.id ?? null,
          dbUrl: activeDbUrl,
        });
  const tableStorageKey =
    env.kind === 'sandbox'
      ? env.storageKeys.tableId
      : resolvePlaygroundDbStorageKey(env.storageKeys.tableId, {
          connectionId: activeConnection?.id ?? null,
          dbUrl: activeDbUrl,
        });
  const [storedBaseId, setStoredBaseId] = useLocalStorage<string | null>(baseStorageKey, null, {
    initializeWithValue: false,
  });
  const [storedTableId, setStoredTableId, removeStoredTableId] = useLocalStorage<string | null>(
    tableStorageKey,
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

  // Bases query - only fetch first 20 for dropdown
  const basesQuery = useQuery<IListBasesOkResponseDto, unknown, ReadonlyArray<IBaseDto>>(
    orpc.bases.list.queryOptions({
      input: { limit: 20, offset: 0 },
      select: (response) => response.data.bases,
    })
  );
  const bases = basesQuery.data ?? [];

  // Create base mutation
  const createBaseMutation = useMutation(
    orpc.bases.create.mutationOptions({
      onSuccess: (response) => {
        const created = response.data.base;
        toast.success(`Created base "${created.name}"`);
        void queryClient.invalidateQueries({
          queryKey: orpc.bases.list.queryKey({ input: {} }),
          exact: false,
        });
        void navigate({
          to: env.routes.base,
          params: { baseId: created.id },
          search: {},
        });
      },
      onError: (error) => {
        toast.error(getErrorMessage(error, 'Failed to create base'));
      },
    })
  );

  const handleCreateBase = (name: string) => {
    createBaseMutation.mutate({ name });
  };

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

  useEffect(() => {
    if (!searchQuery && tablesQuery.data) {
      setBaseTables(tablesQuery.data);
    }
  }, [searchQuery, tablesQuery.data]);

  const optimisticTables = useMemo(() => {
    if (!hasSearch) return baseTables;
    return filterTablesByNameLike(baseTables, trimmedSearch);
  }, [baseTables, hasSearch, trimmedSearch]);

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
    orpc.tables.createTables.mutationOptions({
      onSuccess: (response) => {
        const created = response.data.tables[0];
        if (!created) return;
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
          queryKey: orpc.tables.list.queryKey({ input: { baseId } }),
          exact: false,
        });
        void navigate({
          to: env.routes.table,
          params: { baseId, tableId: created.id },
          search: (prev) => prev,
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

  const handleCreateTemplate = (
    template: TableTemplateDefinition,
    options: { includeRecords: boolean }
  ) => {
    createTableMutation.reset();
    createTableMutation.mutate(template.createInput(baseId, options));
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
      bases={bases}
      isLoadingBases={basesQuery.isLoading}
      onCreateBase={handleCreateBase}
      isCreatingBase={createBaseMutation.isPending}
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
  onCreateTemplate: (
    template: TableTemplateDefinition,
    options: { includeRecords: boolean }
  ) => void;
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
      <section className="relative flex-1 px-6 py-8">
        <div className="pointer-events-none absolute inset-0 bg-grid-pattern opacity-[0.18]" />
        <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-6">
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
        </div>
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
  onCreateTemplate: (
    template: TableTemplateDefinition,
    options: { includeRecords: boolean }
  ) => void;
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
    <header className="relative overflow-hidden border-b border-border/70 bg-background/80 px-6 py-6">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-muted/35 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-dot-pattern opacity-[0.3]" />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <SidebarTrigger className="shrink-0" />
          <div className="h-9 w-px bg-gradient-to-b from-transparent via-border to-transparent" />
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              Base
            </div>
            <div className="text-2xl font-semibold tracking-tight text-foreground">{baseName}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Database className="h-4 w-4 text-muted-foreground" />
              <span>Postgres playground</span>
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                {tableCount} tables
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="h-9 border-border/70 bg-background/80"
            disabled={isLoading}
            onClick={onRefresh}
          >
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <CreateTableDropdown
            templates={templates}
            isCreating={isCreating}
            onSelect={onCreateTemplate}
            label="Create table"
            className="h-9"
          />
        </div>
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
  const skeletonKeys = ['table-row-0', 'table-row-1', 'table-row-2', 'table-row-3'];

  return (
    <Card className="border-border/60 bg-background/80 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-base">
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {skeletonKeys.map((key) => (
          <div key={key} className="flex items-center gap-3">
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
    <Card className="overflow-hidden border-border/60 bg-background/80 shadow-sm">
      <CardHeader className="border-b border-border/60 bg-muted/30">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TableIcon className="h-4 w-4 text-muted-foreground" />
            Tables
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
              {tables.length} total
            </Badge>
          </CardTitle>
          <span className="text-xs text-muted-foreground">Select a table to open</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border/60">
          {tables.map((table) => (
            <div
              key={table.id}
              className="group flex flex-col gap-3 px-5 py-4 transition hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground ring-1 ring-border/50">
                  <TableIcon className="h-4 w-4" />
                </div>
                <div>
                  <Link
                    to={env.routes.table}
                    params={{ baseId, tableId: table.id }}
                    search={search}
                    className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary"
                  >
                    {table.name}
                  </Link>
                  <div className="mt-1 text-xs font-mono text-muted-foreground">{table.id}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
                  {table.fields.length} fields
                </Badge>
                <Button variant="outline" size="sm" className="h-8" asChild>
                  <Link
                    to={env.routes.table}
                    params={{ baseId, tableId: table.id }}
                    search={search}
                  >
                    Open
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

type PlaygroundBaseEmptyStateProps = {
  hasSearch: boolean;
  searchValue: string;
  isCreating: boolean;
  templates: ReadonlyArray<TableTemplateDefinition>;
  onCreateTemplate: (
    template: TableTemplateDefinition,
    options: { includeRecords: boolean }
  ) => void;
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
    <Card className="relative overflow-hidden border border-dashed border-border/70 bg-background/80">
      <div className="pointer-events-none absolute inset-0 bg-dot-pattern opacity-[0.25]" />
      <CardHeader className="relative">
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="relative space-y-4 text-sm text-muted-foreground">
        <p>{description}</p>
        <CreateTableDropdown
          templates={templates}
          isCreating={isCreating}
          onSelect={onCreateTemplate}
          label="Create table"
        />
      </CardContent>
    </Card>
  );
}
