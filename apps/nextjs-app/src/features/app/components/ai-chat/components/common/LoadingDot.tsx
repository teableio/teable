import { cn } from '@teable/ui-lib/shadcn';

export const LoadingDot = ({
  className,
  dotClassName,
}: {
  className?: string;
  dotClassName?: string;
}) => {
  return (
    <div className={cn('flex h-7 items-center space-x-1', className)}>
      <span
        className={cn('size-1 animate-[bounce_1s_infinite] rounded-full bg-gray-500', dotClassName)}
      ></span>
      <span
        className={cn(
          'size-1 animate-[bounce_1s_infinite_0.2s] rounded-full bg-gray-500',
          dotClassName
        )}
      ></span>
      <span
        className={cn(
          'size-1 animate-[bounce_1s_infinite_0.4s] rounded-full bg-gray-500',
          dotClassName
        )}
      ></span>
    </div>
  );
};
