import { Skeleton } from '@teable/ui-lib/shadcn';
import dynamic from 'next/dynamic';

export const DynamicBaseErd = dynamic(() => import('./BaseErd').then((mod) => mod.BaseErd), {
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
});
