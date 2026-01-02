import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from '@tanstack/react-router';
import {
  mapTableDtoToDomain,
  mapTableToDto,
  type IGetTableByIdOkResponseDto,
  type IListTablesOkResponseDto,
  type ITableDto,
} from '@teable/v2-contract-http';
import {
  DefaultTableMapper,
  type ITableFieldPersistenceDTO,
  type ITablePersistenceDTO,
} from '@teable/v2-core';
import { tableTemplates, type TableTemplateDefinition } from '@teable/v2-table-templates';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useLocalStorage } from 'usehooks-ts';

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

  const orpc = createTanstackQueryUtils(useOrpcClient());
  const queryClient = useQueryClient();
  const tableMapper = useMemo(() => new DefaultTableMapper(), []);

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
  const realtimeHasDbFieldNames = useMemo(() => {
    const fields = realtimeDoc.data?.fields ?? [];
    if (!fields.length) return false;
    return fields.every((field) => Boolean(field.dbFieldName));
  }, [realtimeDoc.data]);
  const shouldFetchTable = !realtimeDoc.data || !realtimeHasDbFieldNames;

  const tableQuery = useQuery(
    orpc.tables.getById.queryOptions({
      input: {
        baseId,
        tableId,
      },
      enabled: shouldFetchTable,
      placeholderData: keepPreviousData,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      select: (response) => response.data.table,
    })
  );

  const recordsQuery = useQuery(
    orpc.tables.listRecords.queryOptions({
      input: {
        tableId,
      },
      enabled: Boolean(tableId),
      placeholderData: keepPreviousData,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      select: (response) => response.data.records,
    })
  );

  const tableDto = tableQuery.data ?? null;
  const tableResult = useMemo(() => (tableDto ? mapTableDtoToDomain(tableDto) : null), [tableDto]);
  const table = tableResult?.isOk() ? tableResult.value : null;
  const mappingError = tableResult?.isErr() ? tableResult.error.message : null;
  const records = recordsQuery.data ?? null;
  const recordsError = recordsQuery.error
    ? getErrorMessage(recordsQuery.error, 'Failed to load records')
    : null;

  // Track previous realtime data to avoid unnecessary updates
  const prevRealtimeDocRef = useRef<string | null>(null);
  const prevRealtimeFieldsRef = useRef<string | null>(null);

  useEffect(() => {
    if (!realtimeDoc.data) return;

    // Serialize and compare to detect actual changes
    const serialized = JSON.stringify(realtimeDoc.data);
    if (prevRealtimeDocRef.current === serialized) {
      return; // Data hasn't actually changed, skip update
    }
    prevRealtimeDocRef.current = serialized;

    const dtoResult = tableMapper.toDomain(realtimeDoc.data).andThen(mapTableToDto);
    if (dtoResult.isErr()) return;
    const tableDto = dtoResult.value;
    const mergeTableFields = (
      incoming: ITableDto['fields'],
      existing?: ITableDto['fields']
    ): ITableDto['fields'] => {
      if (!existing?.length) return incoming;
      const existingById = new Map(existing.map((field) => [field.id, field] as const));
      return incoming.map((field) => {
        const previous = existingById.get(field.id);
        if (!previous) return field;
        return {
          ...field,
          isPrimary: field.isPrimary,
          dbFieldName: field.dbFieldName ?? previous.dbFieldName,
          isLookup: field.isLookup ?? previous.isLookup,
          lookupOptions: field.lookupOptions ?? previous.lookupOptions,
          isComputed: field.isComputed ?? previous.isComputed,
          notNull: field.notNull ?? previous.notNull,
          unique: field.unique ?? previous.unique,
          options: field.options ?? previous.options,
          meta: field.meta ?? previous.meta,
          cellValueType: field.cellValueType ?? previous.cellValueType,
          isMultipleCellValue: field.isMultipleCellValue ?? previous.isMultipleCellValue,
        };
      });
    };
    const mergeTableDto = (incoming: ITableDto, existing?: ITableDto): ITableDto => {
      if (!existing) return incoming;
      return {
        ...incoming,
        dbTableName: incoming.dbTableName ?? existing.dbTableName,
        fields: mergeTableFields(incoming.fields, existing.fields),
      };
    };

    queryClient.setQueryData(
      orpc.tables.getById.queryKey({
        input: {
          baseId,
          tableId: tableDto.id,
        },
      }),
      (current) => {
        const existingTable = current && current.ok ? current.data.table : undefined;
        return { ok: true, data: { table: mergeTableDto(tableDto, existingTable) } };
      }
    );

    const updateList = (list: IListTablesOkResponseDto | undefined): IListTablesOkResponseDto => {
      if (!list) {
        return { ok: true, data: { tables: [tableDto] } };
      }
      return {
        ...list,
        data: {
          ...list.data,
          tables: list.data.tables.some((table) => table.id === tableDto.id)
            ? list.data.tables.map((table) =>
                table.id === tableDto.id ? mergeTableDto(tableDto, table) : table
              )
            : [...list.data.tables, tableDto],
        },
      };
    };

    queryClient.setQueryData(orpc.tables.list.queryKey({ input: { baseId } }), updateList);
  }, [baseId, queryClient, orpc, realtimeDoc.data, tableMapper]);

  useEffect(() => {
    if (realtimeFields.status !== 'ready') return;
    // Ensure the realtime data belongs to the current table to prevent cross-table contamination
    // when switching between tables (fields from the previous table should not merge into the current one)
    if (realtimeFields.collection !== realtimeFieldCollection) return;

    // Serialize and compare to detect actual changes
    const serialized = JSON.stringify({
      data: realtimeFields.data,
      removedIds: realtimeFields.removedIds,
    });
    if (prevRealtimeFieldsRef.current === serialized) {
      return; // Data hasn't actually changed, skip update
    }
    prevRealtimeFieldsRef.current = serialized;

    const mergeFields = (table: ITableDto): ITableDto => {
      const incomingById = new Map(realtimeFields.data.map((field) => [field.id, field] as const));
      const removedIds = new Set(realtimeFields.removedIds);

      const mergedFields = table.fields
        .filter((field) => !removedIds.has(field.id))
        .map((field) => {
          const incoming = incomingById.get(field.id);
          if (!incoming) return field;
          return {
            ...field,
            ...incoming,
            isPrimary: field.isPrimary,
            dbFieldName: incoming.dbFieldName ?? field.dbFieldName,
            isLookup: incoming.isLookup ?? field.isLookup,
            lookupOptions: incoming.lookupOptions ?? field.lookupOptions,
            isComputed: incoming.isComputed ?? field.isComputed,
            notNull: incoming.notNull ?? field.notNull,
            unique: incoming.unique ?? field.unique,
            options: incoming.options ?? field.options,
            meta: incoming.meta ?? field.meta,
            cellValueType: incoming.cellValueType ?? field.cellValueType,
            isMultipleCellValue: incoming.isMultipleCellValue ?? field.isMultipleCellValue,
          };
        });

      for (const incoming of realtimeFields.data) {
        if (!table.fields.some((field) => field.id === incoming.id)) {
          mergedFields.push({
            ...incoming,
            isPrimary: false,
            dbFieldName: incoming.dbFieldName ?? undefined,
          } as ITableDto['fields'][number]);
        }
      }

      return {
        ...table,
        fields: mergedFields as ITableDto['fields'],
      };
    };

    queryClient.setQueryData<IGetTableByIdOkResponseDto>(
      orpc.tables.getById.queryKey({
        input: {
          baseId,
          tableId,
        },
      }),
      (current) => {
        if (!current) return current;
        return {
          ...current,
          data: {
            ...current.data,
            table: mergeFields(current.data.table),
          },
        };
      }
    );

    queryClient.setQueryData<IListTablesOkResponseDto>(
      orpc.tables.list.queryKey({ input: { baseId } }),
      (current) => {
        if (!current) return current;
        return {
          ...current,
          data: {
            ...current.data,
            tables: current.data.tables.map((table) =>
              table.id === tableId ? mergeFields(table) : table
            ),
          },
        };
      }
    );
  }, [
    baseId,
    queryClient,
    orpc,
    realtimeFields.collection,
    realtimeFields.data,
    realtimeFields.removedIds,
    realtimeFields.status,
    realtimeFieldCollection,
    tableId,
  ]);

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

  const handleCreateTemplate = (template: TableTemplateDefinition) => {
    createTableMutation.reset();
    createTableMutation.mutate(template.createInput(baseId, template.name));
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

  const handleDeleteField = (fieldId: string) => {
    deleteFieldMutation.reset();
    deleteFieldMutation.mutate({ baseId, tableId, fieldId });
  };

  const handleRecordCreated = () => {
    void recordsQuery.refetch();
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
      recordsError={recordsError}
      isRecordsLoading={recordsQuery.isLoading}
      isRecordsFetching={recordsQuery.isFetching}
      errorMessage={errorMessage}
      onRefresh={handleRefresh}
      onFieldCreated={() => {}}
      onRecordCreated={handleRecordCreated}
      templates={tableTemplates}
      onCreateTemplate={handleCreateTemplate}
      onDelete={handleDelete}
      onDeleteField={handleDeleteField}
      onRename={handleRename}
    />
  );
}
