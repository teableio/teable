import { createFileRoute } from '@tanstack/react-router';

import { PlaygroundRecordRoute } from '@/components/playground/PlaygroundRecordRoute';
import { SandboxOrpcProvider } from '@/lib/orpc/SandboxOrpcProvider';

export const Route = createFileRoute('/sandbox/$baseId/$tableId/$recordId')({
  component: SandboxRecordRoute,
  ssr: false,
});

function SandboxRecordRoute() {
  const { baseId, tableId, recordId } = Route.useParams();
  return (
    <SandboxOrpcProvider>
      <PlaygroundRecordRoute baseId={baseId} tableId={tableId} recordId={recordId} />
    </SandboxOrpcProvider>
  );
}
