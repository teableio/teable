import { Skeleton } from '@teable/ui-lib';

export const ViewSkeleton = () => {
  return (
    <div className="relative size-full overflow-hidden">
      <div className="flex w-full items-center space-x-4">
        <div className="w-full space-y-3 px-2">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
        </div>
      </div>
    </div>
  );
};
