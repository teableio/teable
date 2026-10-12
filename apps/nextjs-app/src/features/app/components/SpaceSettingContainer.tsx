import { cn } from '@teable/ui-lib/shadcn';
import { MobileSettingNavigationTitle } from './setting/MobileSettingNavigation';

interface SpaceSettingContainerProps {
  title: string;
  description?: string | React.ReactElement;
  className?: string;
  children: React.ReactNode | React.ReactNode[];
}

export const SpaceSettingContainer = ({
  title,
  description,
  className,
  children,
}: SpaceSettingContainerProps) => {
  return (
    <div className="size-full">
      <div className="flex size-full flex-col">
        <div className="shrink-0 border-b py-3 pe-14 ps-4 sm:border-0 sm:p-6 sm:pe-12">
          <p className="min-w-0 text-lg font-semibold leading-7">
            <MobileSettingNavigationTitle>{title}</MobileSettingNavigationTitle>
          </p>
          {description && (
            <div className="mt-1 hidden text-sm text-muted-foreground sm:block">{description}</div>
          )}
        </div>
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:gap-6 sm:p-6 sm:pt-0',
            className
          )}
        >
          {description && (
            <div className="shrink-0 text-sm text-muted-foreground sm:hidden">{description}</div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
};
