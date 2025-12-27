import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, createFileRoute, useNavigate } from '@tanstack/react-router';
import { mapTableDtoToDomain, type IListTablesOkResponseDto } from '@teable/v2-contract-http';
import { tableTemplates, type TableTemplateDefinition } from '@teable/v2-table-templates';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLocalStorage } from 'usehooks-ts';

import { TableMetaPage } from '@/components/playground/TableMetaPage';
import { getOrpcClient } from '@/lib/orpcClient';
import {
  PLAYGROUND_BASE_ID,
  PLAYGROUND_BASE_ID_STORAGE_KEY,
  PLAYGROUND_TABLE_ID_STORAGE_KEY,
} from '@/lib/playground/constants';

export const Route = createFileRoute('/$baseId/$tableId')({ component: PlaygroundTableRoute });

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
};

function PlaygroundTableRoute() {
  const { baseId, tableId } = Route.useParams();

  if (tableId === 'new') {
    return <Navigate to="/$baseId" params={{ baseId }} replace />;
  }

  return <PlaygroundTableDetail baseId={baseId} tableId={tableId} />;
}

type PlaygroundTableDetailProps = {
  baseId: string;
  tableId: string;
};

function PlaygroundTableDetail({ baseId, tableId }: PlaygroundTableDetailProps) {
  const [eventCount, setEventCount] = useState<number | null>(null);
  const navigate = useNavigate();
  const [storedBaseId, setStoredBaseId] = useLocalStorage<string | null>(
    PLAYGROUND_BASE_ID_STORAGE_KEY,
    null,
    { initializeWithValue: false }
  );
  const [storedTableId, setStoredTableId, removeStoredTableId] = useLocalStorage<string | null>(
    PLAYGROUND_TABLE_ID_STORAGE_KEY,
    null,
    { initializeWithValue: false }
  );

  const orpc = createTanstackQueryUtils(getOrpcClient());
  const queryClient = useQueryClient();

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

        void navigate({ to: '/$baseId', params: { baseId } });
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

  const tableDto = tableQuery.data ?? null;
  const tableResult = useMemo(() => (tableDto ? mapTableDtoToDomain(tableDto) : null), [tableDto]);
  const table = tableResult?.isOk() ? tableResult.value : null;
  const mappingError = tableResult?.isErr() ? tableResult.error : null;

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
      isInitialLoading={isInitialLoading}
      isLoading={isLoading}
      isCreating={isCreating}
      isDeleting={deleteTableMutation.isPending}
      isRenaming={renameTableMutation.isPending}
      errorMessage={errorMessage}
      onRefresh={handleRefresh}
      templates={tableTemplates}
      onCreateTemplate={handleCreateTemplate}
      onDelete={handleDelete}
      onRename={handleRename}
    />
  );
}
