import { createFileRoute } from '@tanstack/react-router';

import { SandboxOrpcProvider } from '@/lib/orpc/SandboxOrpcProvider';
import { PlaygroundBaseLayout } from '@/routes/$baseId';

export const Route = createFileRoute('/sandbox/$baseId')({
  component: SandboxBaseRoute,
  ssr: false,
});

function SandboxBaseRoute() {
  const { baseId } = Route.useParams();
  return (
    <SandboxOrpcProvider>
      <PlaygroundBaseLayout baseId={baseId} />
    </SandboxOrpcProvider>
  );
}
