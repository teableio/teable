import { cn } from '@teable/ui-lib/shadcn';
import type { ReactNode } from 'react';
import { MobileSettingNavigationTitle } from './MobileSettingNavigation';

type SettingTabShellProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
  mobileNavigation?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

type SettingTabHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
};

const SettingTabHeader = ({ title, description, actions, leading }: SettingTabHeaderProps) => {
  const hasDescription = Boolean(description);
  return (
    <div
      className={cn(
        'flex w-full justify-between gap-6',
        hasDescription ? 'items-start' : 'items-center'
      )}
    >
      <div className={cn('flex flex-1 gap-3', hasDescription ? 'items-start' : 'items-center')}>
        {leading}
        <div className="flex flex-col gap-1.5">
          <div className="text-lg font-semibold leading-7">{title}</div>
          {description && <div className="text-sm text-muted-foreground">{description}</div>}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
      )}
    </div>
  );
};

export const SettingTabShell = ({
  title,
  description,
  actions,
  leading,
  mobileNavigation = true,
  children,
  footer,
  className,
}: SettingTabShellProps) => {
  const hasMobileDetails = Boolean(description || actions);

  return (
    <div className={cn('teable-setting-tab-shell flex h-full flex-col bg-background', className)}>
      <div className="teable-setting-tab-shell__mobile-header flex shrink-0 items-center gap-3 border-b px-4 py-3 pe-14 sm:hidden">
        {leading}
        <div className="min-w-0 flex-1 text-lg font-semibold leading-7">
          <MobileSettingNavigationTitle enabled={mobileNavigation}>
            {title}
          </MobileSettingNavigationTitle>
        </div>
      </div>
      <div className="teable-setting-tab-shell__header hidden items-start justify-between gap-3 p-6 pe-12 sm:flex">
        <SettingTabHeader
          title={title}
          description={description}
          actions={actions}
          leading={leading}
        />
      </div>
      <div className="teable-setting-tab-shell__content flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:gap-6 sm:p-6 sm:pt-0">
        {hasMobileDetails && (
          <div className="flex shrink-0 flex-col gap-3 sm:hidden">
            {description && <div className="text-sm text-muted-foreground">{description}</div>}
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
        )}
        <div className="min-h-0 flex-1">{children}</div>
      </div>
      {footer && (
        <div className="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6 sm:pb-6">
          {footer}
        </div>
      )}
    </div>
  );
};
