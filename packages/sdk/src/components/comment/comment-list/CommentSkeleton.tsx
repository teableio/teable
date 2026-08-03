import { Skeleton } from '@teable/ui-lib';

export const CommentSkeleton = () => {
  return (
    <div className="flex flex-col gap-4 p-2">
      <div className="flex items-center space-x-2">
        <Skeleton className="size-8 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-[250px]" />
          <Skeleton className="h-4 w-[200px]" />
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Skeleton className="size-8 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-[250px]" />
          <Skeleton className="h-4 w-[200px]" />
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Skeleton className="size-8 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-[250px]" />
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <div className="space-y-2">
          <Skeleton className="h-4 w-[250px]" />
          <Skeleton className="h-4 w-[200px]" />
        </div>
        <Skeleton className="size-8 rounded-full" />
      </div>

      <div className="flex items-center space-x-2">
        <div className="space-y-2">
          <Skeleton className="h-4 w-[250px]" />
          <Skeleton className="h-4 w-[200px]" />
        </div>
        <Skeleton className="size-8 rounded-full" />
      </div>

      <div className="flex items-center space-x-2">
        <Skeleton className="size-8 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-[250px]" />
          <Skeleton className="h-4 w-[200px]" />
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Skeleton className="size-8 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-[250px]" />
          <Skeleton className="h-4 w-[200px]" />
        </div>
      </div>
    </div>
  );
};
