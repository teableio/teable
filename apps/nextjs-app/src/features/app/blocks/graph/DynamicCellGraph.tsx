import { Skeleton } from '@teable/ui-lib/shadcn';
import dynamic from 'next/dynamic';

export const DynamicCellGraph = dynamic(() => import('./CellGraph').then((mod) => mod.CellGraph), {
  loading: () => (
    <div className="absolute right-10 top-20 w-96 space-y-2 rounded border bg-background p-4 shadow">
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
    </div>
  ),
  ssr: false,
});
