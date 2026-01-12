import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router';

import { PlaygroundTableRoute } from '@/components/playground/PlaygroundTableRoute';
import { RemoteOrpcProvider } from '@/lib/orpc/RemoteOrpcProvider';

export const Route = createFileRoute('/$baseId/$tableId')({
  component: TableLayoutRoute,
});

function TableLayoutRoute() {
  const { baseId, tableId } = Route.useParams();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const recordPrefix = `/${baseId}/${tableId}/`;
  const isRecordRoute = pathname.startsWith(recordPrefix);

  return (
    <RemoteOrpcProvider>
      {isRecordRoute ? <Outlet /> : <PlaygroundTableRoute baseId={baseId} tableId={tableId} />}
    </RemoteOrpcProvider>
  );
}
