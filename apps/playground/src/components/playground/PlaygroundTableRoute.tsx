import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { mapTableDtoToDomain, type IListTablesOkResponseDto } from '@teable/v2-contract-http';
import { type ITableFieldPersistenceDTO, type ITablePersistenceDTO } from '@teable/v2-core';
import { tableTemplates, type TableTemplateDefinition } from '@teable/v2-table-templates';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLocalStorage } from 'usehooks-ts';

/** Default page size for records */
const DEFAULT_PAGE_SIZE = 20;

import { TableMetaPage } from '@/components/playground/TableMetaPage';
import { useBroadcastChannelDoc, useBroadcastChannelQuery } from '@/lib/broadcastChannel';
import { useOrpcClient } from '@/lib/orpc/OrpcClientContext';
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

  // Pagination state for records
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Reset pagination when table changes
  useEffect(() => {
    setPageIndex(0);
  }, [tableId]);

  const orpcClient = useOrpcClient();
  const orpc = createTanstackQueryUtils(orpcClient);
  const queryClient = useQueryClient();

  const createTableMutation = useMutation(
    orpc.tables.create.mutationOptions({
      onSuccess: (response) => {
        const created = response.data.table;
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
    options: { includeRecords: boolean; recordCount: number }
  ) => {
    createTableMutation.reset();
    createTableMutation.mutate(template.createInput(baseId, template.name, options));
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
      onRename={handleRename}
    />
  );
}
