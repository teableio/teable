import { createFileRoute } from '@tanstack/react-router';

import { PlaygroundIndex } from '@/routes/index';

export const Route = createFileRoute('/sandbox/')({
  component: PlaygroundIndex,
  ssr: false,
});
