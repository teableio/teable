import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { mapTableDtoToDomain, type IListTablesOkResponseDto } from '@teable/v2-contract-http';
import type {
  ITableFieldPersistenceDTO,
  ITablePersistenceDTO,
  ITableRecordRealtimeDTO,
} from '@teable/v2-core';
import { tableTemplates, type TableTemplateDefinition } from '@teable/v2-table-templates';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLocalStorage } from 'usehooks-ts';

/** Default page size for records */
const DEFAULT_PAGE_SIZE = 20;

import { TableMetaPage } from '@/components/playground/TableMetaPage';
import { useBroadcastChannelDoc, useBroadcastChannelQuery } from '@/lib/broadcastChannel';
import { useOrpcClient } from '@/lib/orpc/OrpcClientContext';
import {
  PLAYGROUND_DB_CONNECTIONS_STORAGE_KEY,
  PLAYGROUND_DB_URL_STORAGE_KEY,
  findPlaygroundDbConnectionByUrl,
  resolvePlaygroundDbUrl,
  resolvePlaygroundDbStorageKey,
  type PlaygroundDbConnection,
} from '@/lib/playground/databaseUrl';
import { usePlaygroundEnvironment } from '@/lib/playground/environment';
import { useShareDbDoc, useShareDbQuery } from '@/lib/shareDb';

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
};

type PlaygroundTableDetailProps = {
  baseId: string;
  tableId: string;
};

export function PlaygroundTableRoute({ baseId, tableId }: PlaygroundTableDetailProps) {
  const env = usePlaygroundEnvironment();

  if (tableId === 'new') {
    return <Navigate to={env.routes.base} params={{ baseId }} replace />;
  }

  return <PlaygroundTableDetail baseId={baseId} tableId={tableId} />;
}

function PlaygroundTableDetail({ baseId, tableId }: PlaygroundTableDetailProps) {
  const env = usePlaygroundEnvironment();
  const [eventCount, setEventCount] = useState<number | null>(null);
  const navigate = useNavigate();
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

  // Pagination state for records
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Reset pagination when table changes
  useEffect(() => {
    if (!tableId) return;
    setPageIndex(0);
  }, [tableId]);

  const orpcClient = useOrpcClient();
  const orpc = createTanstackQueryUtils(orpcClient);
  const queryClient = useQueryClient();

  const createTableMutation = useMutation(
    orpc.tables.createTables.mutationOptions({
      onSuccess: (response) => {
        const created = response.data.tables[0];
        if (!created) return;
        setEventCount(response.data.events.length);
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
      onSuccess: () => {
        queryClient.removeQueries({
          queryKey: orpc.tables.getById.queryKey({
            input: {
              baseId,
              tableId,
            },
          }),
        });

        const removeFromList = (list: IListTablesOkResponseDto | undefined) =>
          list
            ? {
                ...list,
                data: {
                  ...list.data,
                  tables: list.data.tables.filter((table) => table.id !== tableId),
                },
              }
            : list;

        queryClient.setQueryData(orpc.tables.list.queryKey({ input: { baseId } }), removeFromList);

        if (storedBaseId === baseId && storedTableId === tableId) {
          removeStoredTableId();
        }

        void queryClient.invalidateQueries({
          queryKey: orpc.tables.list.queryKey({ input: { baseId } }),
          exact: false,
        });

        void navigate({ to: env.routes.base, params: { baseId } });
      },
      onError: (error) => {
        toast.error(getErrorMessage(error, 'Failed to delete table'));
      },
    })
  );

  const renameTableMutation = useMutation(
    orpc.tables.rename.mutationOptions({
      onSuccess: (response) => {
        const updated = response.data.table;
        setEventCount(response.data.events.length);

        queryClient.setQueryData(
          orpc.tables.getById.queryKey({
            input: {
              baseId,
              tableId,
            },
          }),
          { ok: true, data: { table: updated } }
        );

        const updateList = (list: IListTablesOkResponseDto | undefined) =>
          list
            ? {
                ...list,
                data: {
                  ...list.data,
                  tables: list.data.tables.map((table) =>
                    table.id === updated.id ? updated : table
                  ),
                },
              }
            : list;

        queryClient.setQueryData(orpc.tables.list.queryKey({ input: { baseId } }), updateList);

        void queryClient.invalidateQueries({
          queryKey: orpc.tables.list.queryKey({ input: { baseId } }),
          exact: false,
        });
      },
      onError: (error) => {
        toast.error(getErrorMessage(error, 'Failed to rename table'));
      },
    })
  );

  const deleteFieldMutation = useMutation(
    orpc.tables.deleteField.mutationOptions({
      onSuccess: (response) => {
        const updated = response.data.table;
        setEventCount(response.data.events.length);

        queryClient.setQueryData(
          orpc.tables.getById.queryKey({
            input: {
              baseId,
              tableId,
            },
          }),
          { ok: true, data: { table: updated } }
        );

        const updateList = (list: IListTablesOkResponseDto | undefined) =>
          list
            ? {
                ...list,
                data: {
                  ...list.data,
                  tables: list.data.tables.map((table) =>
                    table.id === updated.id ? updated : table
                  ),
                },
              }
            : list;

        queryClient.setQueryData(orpc.tables.list.queryKey({ input: { baseId } }), updateList);

        void queryClient.invalidateQueries({
          queryKey: orpc.tables.list.queryKey({ input: { baseId } }),
          exact: false,
        });
      },
      onError: (error) => {
        toast.error(getErrorMessage(error, 'Failed to delete field'));
      },
    })
  );

  const deleteRecordsMutation = useMutation(
    orpc.tables.deleteRecords.mutationOptions({
      onSuccess: (response) => {
        setEventCount(response.data.events.length);
        const deletedCount = response.data.deletedRecordIds.length;
        toast.success(`Deleted ${deletedCount} record${deletedCount === 1 ? '' : 's'}`);
        void recordsQuery.refetch();
      },
      onError: (error) => {
        toast.error(getErrorMessage(error, 'Failed to delete record'));
      },
    })
  );

  useEffect(() => {
    setStoredBaseId(baseId);
    setStoredTableId(tableId);
  }, [baseId, setStoredBaseId, setStoredTableId, tableId]);

  const isSandbox = env.kind === 'sandbox';
  const realtimeCollection = useMemo(() => `tbl_${baseId}`, [baseId]);
  const shareDbDoc = useShareDbDoc<ITablePersistenceDTO>({
    collection: realtimeCollection,
    docId: tableId,
    enabled: !isSandbox,
  });
  const realtimeFieldCollection = useMemo(() => `fld_${tableId}`, [tableId]);
  const shareDbFields = useShareDbQuery<ITableFieldPersistenceDTO>({
    collection: realtimeFieldCollection,
    query: {},
    enabled: !isSandbox,
    filter: (doc) => {
      const data = doc.data as { id?: unknown } | null | undefined;
      return Boolean(doc.type) && typeof data?.id === 'string';
    },
  });
  const broadcastDoc = useBroadcastChannelDoc<ITablePersistenceDTO>({
    collection: realtimeCollection,
    docId: tableId,
    enabled: isSandbox,
  });
  const broadcastFields = useBroadcastChannelQuery<ITableFieldPersistenceDTO>({
    collection: realtimeFieldCollection,
    enabled: isSandbox,
    getId: (snapshot) => snapshot.id,
  });
  const realtimeDoc = isSandbox ? broadcastDoc : shareDbDoc;
  const realtimeFields = isSandbox ? broadcastFields : shareDbFields;

  // Record realtime subscription
  const realtimeRecordCollection = useMemo(() => `rec_${tableId}`, [tableId]);
  const shareDbRecords = useShareDbQuery<ITableRecordRealtimeDTO>({
    collection: realtimeRecordCollection,
    query: {},
    enabled: !isSandbox,
    filter: (doc) => {
      const data = doc.data as { id?: unknown } | null | undefined;
      return Boolean(doc.type) && typeof data?.id === 'string';
    },
  });
  const broadcastRecords = useBroadcastChannelQuery<ITableRecordRealtimeDTO>({
    collection: realtimeRecordCollection,
    enabled: isSandbox,
    getId: (snapshot) => snapshot.id,
  });
  const realtimeRecords = isSandbox ? broadcastRecords : shareDbRecords;

  const tableQuery = useQuery(
    orpc.tables.getById.queryOptions({
      input: {
        baseId,
        tableId,
      },
      placeholderData: keepPreviousData,
      select: (response) => response.data.table,
    })
  );

  const recordsQuery = useQuery(
    orpc.tables.listRecords.queryOptions({
      input: {
        tableId,
        limit: pageSize,
        offset: pageIndex * pageSize,
      },
      enabled: Boolean(tableId),
      placeholderData: keepPreviousData,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      select: (response) => ({
        records: response.data.records,
        pagination: response.data.pagination,
      }),
    })
  );

  const tableDto = tableQuery.data ?? null;
  const tableResult = useMemo(() => (tableDto ? mapTableDtoToDomain(tableDto) : null), [tableDto]);
  const table = tableResult?.isOk() ? tableResult.value : null;
  const mappingError = tableResult?.isErr() ? tableResult.error.message : null;
  const records = recordsQuery.data?.records ?? null;
  const recordsPagination = recordsQuery.data?.pagination ?? null;
  const recordsError = recordsQuery.error
    ? getErrorMessage(recordsQuery.error, 'Failed to load records')
    : null;

  // Sync realtime records data to TanStack Query cache
  useEffect(() => {
    if (!realtimeRecords.data || realtimeRecords.data.length === 0) return;

    const queryKey = orpc.tables.listRecords.queryOptions({
      input: {
        tableId,
        limit: pageSize,
        offset: pageIndex * pageSize,
      },
    }).queryKey;

    type RecordsQueryData = {
      ok: true;
      data: {
        records: Array<{ id: string; fields: Record<string, unknown> }>;
        pagination: unknown;
      };
    };

    queryClient.setQueryData<RecordsQueryData | undefined>(queryKey, (oldData) => {
      if (!oldData?.data?.records) return oldData;

      // Create a map of realtime records by id for quick lookup
      const realtimeMap = new Map(realtimeRecords.data.map((r) => [r.id, r]));

      // Update records with realtime data
      const updatedRecords = oldData.data.records.map((record) => {
        const realtimeRecord = realtimeMap.get(record.id);
        if (!realtimeRecord) return record;

        return {
          ...record,
          fields: {
            ...record.fields,
            ...realtimeRecord.fields,
          },
        };
      });

      return {
        ...oldData,
        data: {
          ...oldData.data,
          records: updatedRecords,
        },
      };
    });
  }, [realtimeRecords.data, queryClient, orpc, tableId, pageSize, pageIndex]);

  // Pagination change handler
  const handlePaginationChange = useCallback(
    (pagination: { pageIndex: number; pageSize: number }) => {
      setPageIndex(pagination.pageIndex);
      setPageSize(pagination.pageSize);
    },
    []
  );

  const isInitialLoading = !table && tableQuery.isLoading;
  const isLoading = tableQuery.isFetching;
  const isCreating = createTableMutation.isPending;
  const errorMessage = (() => {
    if (mappingError) return mappingError;
    if (tableQuery.error) {
      return getErrorMessage(tableQuery.error, 'Failed to load table');
    }
    if (createTableMutation.error) {
      return getErrorMessage(createTableMutation.error, 'Failed to create table');
    }
    return null;
  })();

  const handleCreateTemplate = (
    template: TableTemplateDefinition,
    options: { includeRecords: boolean }
  ) => {
    createTableMutation.reset();
    createTableMutation.mutate(template.createInput(baseId, options));
  };

  const handleDelete = () => {
    deleteTableMutation.reset();
    deleteTableMutation.mutate({ baseId, tableId });
  };

  const handleRename = (name: string) => {
    renameTableMutation.reset();
    renameTableMutation.mutate({ baseId, tableId, name });
  };

  const handleRefresh = () => {
    void tableQuery.refetch();
    void recordsQuery.refetch();
  };

  const handleFieldCreated = () => {
    void tableQuery.refetch();
  };

  const handleDeleteField = (fieldId: string) => {
    deleteFieldMutation.reset();
    deleteFieldMutation.mutate({ baseId, tableId, fieldId });
  };

  const handleDeleteRecords = (recordIds: string[]) => {
    if (!recordIds.length) return;
    deleteRecordsMutation.reset();
    deleteRecordsMutation.mutate({ tableId, recordIds });
  };

  const handleRecordCreated = () => {
    void recordsQuery.refetch();
  };

  const handleImportCsv = async (data: {
    tableName: string;
    csvData?: string;
    csvUrl?: string;
  }): Promise<void> => {
    try {
      const result = await orpcClient.tables.importCsv({
        baseId,
        ...(data.csvUrl ? { csvUrl: data.csvUrl } : { csvData: data.csvData! }),
        tableName: data.tableName,
        batchSize: 5000,
      });

      toast.success(`Imported ${result.data.totalImported} records into "${data.tableName}"`);

      // Navigate to new table and refresh
      setStoredTableId(result.data.table.id);
      void navigate({
        to: env.routes.table,
        params: { baseId, tableId: result.data.table.id },
        search: (prev) => prev,
      });
    } catch (error) {
      const errorMsg = getErrorMessage(error, 'Failed to import CSV');
      toast.error(errorMsg);
      throw error;
    }
  };

  return (
    <TableMetaPage
      baseId={baseId}
      tableId={tableId}
      table={table}
      eventCount={eventCount}
      realtimeSnapshot={realtimeDoc.data}
      realtimeStatus={realtimeDoc.status}
      realtimeError={realtimeDoc.error}
      realtimeFieldSnapshots={realtimeFields.data}
      realtimeFieldStatus={realtimeFields.status}
      realtimeFieldError={realtimeFields.error}
      realtimeRecordSnapshots={realtimeRecords.data}
      realtimeRecordStatus={realtimeRecords.status}
      realtimeRecordError={realtimeRecords.error}
      isInitialLoading={isInitialLoading}
      isLoading={isLoading}
      isCreating={isCreating}
      isDeleting={deleteTableMutation.isPending}
      isDeletingField={deleteFieldMutation.isPending}
      isRenaming={renameTableMutation.isPending}
      records={records}
      recordsPagination={recordsPagination}
      recordsError={recordsError}
      isRecordsLoading={recordsQuery.isLoading}
      isRecordsFetching={recordsQuery.isFetching}
      isDeletingRecord={deleteRecordsMutation.isPending}
      errorMessage={errorMessage}
      onRefresh={handleRefresh}
      onFieldCreated={handleFieldCreated}
      onRecordCreated={handleRecordCreated}
      onPaginationChange={handlePaginationChange}
      templates={tableTemplates}
      onCreateTemplate={handleCreateTemplate}
      onImportCsv={handleImportCsv}
      onDelete={handleDelete}
      onDeleteField={handleDeleteField}
      onDeleteRecords={handleDeleteRecords}
      onRename={handleRename}
    />
  );
}
