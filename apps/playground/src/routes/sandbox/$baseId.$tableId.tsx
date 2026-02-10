import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router';

import { PlaygroundTableRoute } from '@/components/playground/PlaygroundTableRoute';
import { SandboxOrpcProvider } from '@/lib/orpc/SandboxOrpcProvider';

export const Route = createFileRoute('/sandbox/$baseId/$tableId')({
  component: SandboxTableLayout,
  ssr: false,
});

function SandboxTableLayout() {
  const { baseId, tableId } = Route.useParams();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const recordPrefix = `/sandbox/${baseId}/${tableId}/`;
  const isRecordRoute = pathname.startsWith(recordPrefix);

  return (
    <SandboxOrpcProvider>
      {isRecordRoute ? <Outlet /> : <PlaygroundTableRoute baseId={baseId} tableId={tableId} />}
    </SandboxOrpcProvider>
  );
}
