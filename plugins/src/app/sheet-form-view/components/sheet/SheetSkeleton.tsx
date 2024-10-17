import { cn, Skeleton } from '@teable/ui-lib';

interface ISheetSkeletonProps {
  className?: string;
}

export const SheetSkeleton = (props: ISheetSkeletonProps) => {
  const { className } = props;

  return (
    <div className={cn('flex flex-1 flex-col space-y-2 overflow-hidden', className)}>
      <Skeleton className="h-16 w-full shrink-0" />
      {Array.from({ length: 40 }).map((_, index) => (
        <div className="flex flex-1 overflow-hidden" key={index}>
          {Array.from({ length: 20 }).map((_, index) => (
            <div className="flex flex-col space-y-2 border" key={index}>
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
