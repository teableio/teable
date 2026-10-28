import { cn } from '@teable/ui-lib/shadcn';
import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';
import { MobileSettingNavigationTitle } from './MobileSettingNavigation';

interface ISettingTabGroup {
  title: ReactNode;
  tabs: ReactNode;
}

const SettingTabGroupContext = createContext<ISettingTabGroup | null>(null);

/** Hosts several setting pages under one sidebar entry: they show its title and tab bar. */
export const SettingTabGroupProvider = SettingTabGroupContext.Provider;

type SettingTabShellProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
  mobileNavigation?: boolean;
  /**
   * Inside a page that hosts several (Developer tools), whether this view shows that page's
   * title and tab bar. A flow opened from a tab, behind a back button, turns it off to show its
   * own title instead.
   */
  grouped?: boolean;
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
  grouped = true,
  children,
  footer,
  className,
}: SettingTabShellProps) => {
  // A grouped view shows the group's title and tab bar; its description and actions then sit
  // under the tab bar, since they are about the selected tab, not the group.
  const groupContext = useContext(SettingTabGroupContext);
  const group = grouped ? groupContext : null;
  const hasDetails = Boolean(description || actions);

  return (
    <div className={cn('teable-setting-tab-shell flex h-full flex-col bg-background', className)}>
      <div className="teable-setting-tab-shell__mobile-header flex shrink-0 items-center gap-3 border-b px-4 py-3 pe-14 sm:hidden">
        {leading}
        <div className="min-w-0 flex-1 text-lg font-semibold leading-7">
          <MobileSettingNavigationTitle enabled={mobileNavigation}>
            {group?.title ?? title}
          </MobileSettingNavigationTitle>
        </div>
      </div>
      <div className="teable-setting-tab-shell__header hidden items-start justify-between gap-3 p-6 pe-12 sm:flex">
        <SettingTabHeader
          title={group?.title ?? title}
          description={group ? undefined : description}
          actions={group ? undefined : actions}
          leading={leading}
        />
      </div>
      {group && <div className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-0">{group.tabs}</div>}
      <div
        className={cn(
          'teable-setting-tab-shell__content flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:gap-6 sm:p-6',
          !group && 'sm:pt-0'
        )}
      >
        {hasDetails && (
          <div
            className={cn(
              'flex shrink-0 flex-col gap-3',
              group ? 'sm:flex-row sm:items-start sm:justify-between sm:gap-6' : 'sm:hidden'
            )}
          >
            {description && <div className="text-sm text-muted-foreground">{description}</div>}
            {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
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
