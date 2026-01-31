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
        'flex w-full justify-between gap-4',
        hasDescription ? 'items-start' : 'items-center',
        className
      )}
    >
      <div className={cn('flex flex-1 gap-2', hasDescription ? 'items-start' : 'items-center')}>
        {leading}
        <div className="flex flex-col gap-1">
          <div className={cn('text-base font-semibold leading-6', titleClassName)}>{title}</div>
          {description && (
            <div className={cn('line-clamp-2 text-sm text-muted-foreground', descriptionClassName)}>
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
    <div
      className={cn(
        'teable-setting-tab-shell flex h-full flex-col border-l bg-background',
        className
      )}
    >
      {header && (
        <div
          className={cn(
            'teable-setting-tab-shell__header flex items-start justify-between gap-3 border-b pl-6 py-3 pr-10',
            headerClassName
          )}
        >
          {header}
        </div>
      )}
      <div
        className={cn(
          'teable-setting-tab-shell__content flex-1 overflow-y-auto px-6 py-4',
          contentClassName
        )}
      >
        {children}
      </div>
      {footer && <div className={cn('px-8 py-4', footerClassName)}>{footer}</div>}
    </div>
  );
};
