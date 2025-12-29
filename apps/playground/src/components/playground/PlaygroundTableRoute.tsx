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
import { useEffect, useMemo, useState } from 'react';
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
  });
  const broadcastDoc = useBroadcastChannelDoc<ITablePersistenceDTO>({
    collection: realtimeCollection,
    docId: tableId,
    enabled: isSandbox,
  });
  const broadcastFields = useBroadcastChannelQuery<ITableFieldPersistenceDTO>({
    collection: realtimeFieldCollection,
    enabled: isSandbox,
  });
  const realtimeDoc = isSandbox ? broadcastDoc : shareDbDoc;
  const realtimeFields = isSandbox ? broadcastFields : shareDbFields;
  const shouldFetchTable = !realtimeDoc.data;

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

  const tableDto = tableQuery.data ?? null;
  const tableResult = useMemo(() => (tableDto ? mapTableDtoToDomain(tableDto) : null), [tableDto]);
  const table = tableResult?.isOk() ? tableResult.value : null;
  const mappingError = tableResult?.isErr() ? tableResult.error : null;

  useEffect(() => {
    if (!realtimeDoc.data) return;
    const dtoResult = tableMapper.toDomain(realtimeDoc.data).andThen(mapTableToDto);
    if (dtoResult.isErr()) return;
    const tableDto = dtoResult.value;

    queryClient.setQueryData(
      orpc.tables.getById.queryKey({
        input: {
          baseId,
          tableId: tableDto.id,
        },
      }),
      { ok: true, data: { table: tableDto } }
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
            ? list.data.tables.map((table) => (table.id === tableDto.id ? tableDto : table))
            : [...list.data.tables, tableDto],
        },
      };
    };

    queryClient.setQueryData(orpc.tables.list.queryKey({ input: { baseId } }), updateList);
  }, [baseId, queryClient, orpc, realtimeDoc.data, tableMapper]);

  useEffect(() => {
    if (realtimeFields.data.length === 0) return;
    const mergeFields = (table: ITableDto): ITableDto => {
      const incomingById = new Map(realtimeFields.data.map((field) => [field.id, field] as const));
      const mergedFields = table.fields.map((field) => {
        const incoming = incomingById.get(field.id);
        if (!incoming) return field;
        return {
          ...field,
          ...incoming,
          isPrimary: field.isPrimary,
          dbFieldName: incoming.dbFieldName ?? field.dbFieldName,
        };
      });

      for (const incoming of realtimeFields.data) {
        if (!table.fields.some((field) => field.id === incoming.id)) {
          mergedFields.push({
            ...incoming,
            isPrimary: false,
          });
        }
      }

      return {
        ...table,
        fields: mergedFields,
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
  }, [baseId, queryClient, orpc, realtimeFields.data, tableId]);

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
      isRenaming={renameTableMutation.isPending}
      errorMessage={errorMessage}
      onRefresh={handleRefresh}
      onFieldCreated={() => {}}
      templates={tableTemplates}
      onCreateTemplate={handleCreateTemplate}
      onDelete={handleDelete}
      onRename={handleRename}
    />
  );
}
