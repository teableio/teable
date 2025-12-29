import { createFileRoute } from '@tanstack/react-router';

import { PlaygroundTableRoute } from '@/components/playground/PlaygroundTableRoute';
import { RemoteOrpcProvider } from '@/lib/orpc/RemoteOrpcProvider';

export const Route = createFileRoute('/$baseId/$tableId')({
  component: PlaygroundTableRouteWrapper,
});

function PlaygroundTableRouteWrapper() {
  const { baseId, tableId } = Route.useParams();
  return (
    <RemoteOrpcProvider>
      <PlaygroundTableRoute baseId={baseId} tableId={tableId} />
    </RemoteOrpcProvider>
  );
}
