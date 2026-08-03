import { useTheme } from '@teable/next-themes';
import { cn, Skeleton } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
export const IntegrationContainer = (props: {
  children: React.ReactNode;
  count?: number;
  isLoading?: boolean;
  description?: string | React.ReactNode;
}) => {
  const { children, count, isLoading, description } = props;
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const isEmpty = typeof count === 'number' && count === 0;
  return (
    <div className="h-full overflow-auto py-4">
      <div
        className={cn(
          'flex px-3 size-full flex-col items-center justify-center gap-4 text-center text-sm text-muted-foreground',
          {
            'h-auto items-start': !isEmpty,
          }
        )}
      >
        {isEmpty && (
          <Image
            src={
              isDark
                ? '/images/layout/empty-integration-dark.png'
                : '/images/layout/empty-integration-light.png'
            }
            width={160}
            height={160}
            alt="No integrations available"
          />
        )}
        {description}
      </div>
      <div className="flex-1 overflow-auto px-3">
        {isLoading ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
};
