import { createFileRoute } from '@tanstack/react-router';

import { PlaygroundRecordRoute } from '@/components/playground/PlaygroundRecordRoute';
import { RemoteOrpcProvider } from '@/lib/orpc/RemoteOrpcProvider';

export const Route = createFileRoute('/$baseId/$tableId/$recordId')({
  component: PlaygroundRecordRouteWrapper,
});

function PlaygroundRecordRouteWrapper() {
  const { baseId, tableId, recordId } = Route.useParams();
  return (
    <RemoteOrpcProvider>
      <PlaygroundRecordRoute baseId={baseId} tableId={tableId} recordId={recordId} />
    </RemoteOrpcProvider>
  );
}
