import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { mapTableDtoToDomain } from '@teable/v2-contract-http';

import { TableMetaPage } from '@/components/playground/TableMetaPage';
import { getOrpcClient } from '@/lib/orpcClient';
import { buildBasicTableInput } from '@/lib/playground/basicTable';
import {
  PLAYGROUND_BASE_ID,
  PLAYGROUND_BASE_NAME,
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
  const baseName = baseId === PLAYGROUND_BASE_ID ? PLAYGROUND_BASE_NAME : baseId;

  const orpc = createTanstackQueryUtils(getOrpcClient());
  const queryClient = useQueryClient();

  const tableQuery = useQuery(
    orpc.tables.getById.queryOptions({
      input: {
        baseId,
        tableId,
      },
      select: (response) => response.data.table,
    })
  );

  const createTableMutation = useMutation(
    orpc.tables.create.mutationOptions({
      onSuccess: (response) => {
        const created = response.data.table;
        setEventCount(response.data.events.length);
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(PLAYGROUND_TABLE_ID_STORAGE_KEY, tableId);
  }, [tableId]);

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

  const handleCreate = () => {
    createTableMutation.reset();
    createTableMutation.mutate(buildBasicTableInput(baseId, `Playground Table ${Date.now()}`));
  };

  const handleRefresh = () => {
    void tableQuery.refetch();
  };

  return (
    <TableMetaPage
      baseId={baseId}
      baseName={baseName}
      tableId={tableId}
      table={table}
      eventCount={eventCount}
      isInitialLoading={isInitialLoading}
      isLoading={isLoading}
      isCreating={isCreating}
      errorMessage={errorMessage}
      onRefresh={handleRefresh}
      onCreate={handleCreate}
    />
  );
}
