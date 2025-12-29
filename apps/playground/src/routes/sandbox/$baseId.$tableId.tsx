import { createFileRoute } from '@tanstack/react-router';

import { SandboxOrpcProvider } from '@/lib/orpc/SandboxOrpcProvider';
import { PlaygroundTableRoute } from '@/components/playground/PlaygroundTableRoute';

export const Route = createFileRoute('/sandbox/$baseId/$tableId')({
  component: SandboxTableRoute,
  ssr: false,
});

function SandboxTableRoute() {
  const { baseId, tableId } = Route.useParams();
  return (
    <SandboxOrpcProvider>
      <PlaygroundTableRoute baseId={baseId} tableId={tableId} />
    </SandboxOrpcProvider>
  );
}
