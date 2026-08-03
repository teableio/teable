import { cn } from '@teable/ui-lib/shadcn';
import type { ReactNode } from 'react';

type SettingTabShellProps = {
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
};

type SettingTabHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
};

export const SettingTabHeader = ({
  title,
  description,
  actions,
  leading,
  className,
  titleClassName,
  descriptionClassName,
}: SettingTabHeaderProps) => {
  const hasDescription = Boolean(description);
  return (
    <div
      className={cn(
        'flex w-full justify-between gap-6',
        hasDescription ? 'items-start' : 'items-center',
        className
      )}
    >
      <div className={cn('flex flex-1 gap-3', hasDescription ? 'items-start' : 'items-center')}>
        {leading}
        <div className="flex flex-col gap-1.5">
          <div className={cn('text-lg font-semibold leading-7', titleClassName)}>{title}</div>
          {description && (
            <div className={cn('text-sm text-muted-foreground', descriptionClassName)}>
              {description}
            </div>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
      )}
    </div>
  );
};

export const SettingTabShell = ({
  header,
  children,
  footer,
  className,
  headerClassName,
  contentClassName,
  footerClassName,
}: SettingTabShellProps) => {
  return (
    <div className={cn('teable-setting-tab-shell flex h-full flex-col bg-background', className)}>
      {header && (
        <div
          className={cn(
            'teable-setting-tab-shell__header flex items-start justify-between gap-3 px-4 pb-4 pt-4 pr-16 sm:px-6 sm:pb-6 sm:pt-6 sm:pr-12',
            headerClassName
          )}
        >
          {header}
        </div>
      )}
      <div
        className={cn(
          'teable-setting-tab-shell__content flex-1 overflow-y-auto px-4 sm:px-6',
          contentClassName
        )}
      >
        {children}
      </div>
      {footer && (
        <div className={cn('px-4 pb-4 pt-4 sm:px-6 sm:pb-6', footerClassName)}>{footer}</div>
      )}
    </div>
  );
};
