import { Skeleton } from '@teable/ui-lib/shadcn';
import dynamic from 'next/dynamic';

export const DynamicFieldGraph = dynamic(
  () => import('./FieldGraph').then((mod) => mod.FieldGraph),
  {
    loading: () => (
      <div className="space-y-2 p-4">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    ),
    ssr: false,
  }
);
