import { Skeleton, Separator } from '@teable-group/ui-lib';

export const PaneSkeleton = () => {
  return (
    <div className="fixed flex size-full overflow-hidden">
      <div className="flex h-full w-1/4 flex-col justify-between border-r p-2">
        <div className="w-full space-y-2">
          <Skeleton className="h-6" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Separator></Separator>
          <Skeleton className="h-6" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
        </div>
        <div className="w-full space-y-2">
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
        </div>
      </div>

      <div className="flex-1 flex-col">
        <div className="flex h-10 items-center justify-between border-b px-2">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-6 w-1/4" />
        </div>
        <div className="p-2">
          <Skeleton className="h-8 w-full" />

          <Skeleton className="mt-4 h-56 w-full" />
        </div>
      </div>
    </div>
  );
};
