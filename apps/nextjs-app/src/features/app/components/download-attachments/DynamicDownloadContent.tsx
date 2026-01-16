import { Skeleton } from '@teable/ui-lib/shadcn';
import dynamic from 'next/dynamic';

export const DynamicDownloadContent = dynamic(
  () => import('./DownloadContent').then((mod) => mod.DownloadContent),
  {
    loading: () => (
      <div className="flex flex-col gap-3 py-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-5 w-40" />
      </div>
    ),
    ssr: false,
  }
);
