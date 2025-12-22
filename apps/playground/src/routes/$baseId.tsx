import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Outlet, useMatch } from '@tanstack/react-router';

import { PlaygroundShell } from '@/components/playground/PlaygroundShell';
import { getOrpcClient } from '@/lib/orpcClient';

export const Route = createFileRoute('/$baseId')({ component: PlaygroundBaseLayout });

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
};

function PlaygroundBaseLayout() {
  const { baseId } = Route.useParams();
  const tableMatch = useMatch({ from: '/$baseId/$tableId', shouldThrow: false });
  const activeTableId = tableMatch?.params.tableId ?? null;

  const orpc = createTanstackQueryUtils(getOrpcClient());
  const tablesQuery = useQuery(
    orpc.tables.list.queryOptions({
      input: { baseId },
      select: (response) => response.data.tables,
    })
  );

  const tables = tablesQuery.data ?? [];
  const errorMessage = tablesQuery.error
    ? getErrorMessage(tablesQuery.error, 'Failed to load tables')
    : null;

  return (
    <PlaygroundShell
      baseId={baseId}
      activeTableId={activeTableId}
      tables={tables}
      isInitialLoading={tablesQuery.isLoading}
      errorMessage={errorMessage}
    >
      <Outlet />
    </PlaygroundShell>
  );
}
