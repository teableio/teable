import { Skeleton } from '@teable/ui-lib/shadcn';
import dynamic from 'next/dynamic';

export const DynamicFieldEditor = dynamic(
  () => import('./FieldEditor').then((mod) => mod.FieldEditor),
  {
    loading: () => (
      <div className="h-full space-y-2 p-4">
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
