import { Skeleton } from '@teable/ui-lib/shadcn';

/**
 * Mirrors the table page main area (header / toolbar / rows). Shared by the
 * base-entry transition overlay and DynamicTable's loading fallback so the
 * space→base transition and a hard refresh read identically. Must stay free
 * of table-chunk imports — it renders while that chunk is still downloading.
 */
export const TableSkeleton = () => (
  <div className="flex h-full min-w-0 flex-1 flex-col">
    <div className="flex h-12 shrink-0 items-center gap-3 border-b px-2">
      <Skeleton className="h-7 w-64" />
    </div>
    <div className="flex h-12 shrink-0 items-center gap-3 px-2">
      <Skeleton className="h-6 w-64" />
    </div>
    <div className="w-full space-y-3 px-2">
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-7 w-full" />
    </div>
  </div>
);
