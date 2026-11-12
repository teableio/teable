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
  actions?: ReactNode;
  leading?: ReactNode;
};

// min-h-9 fits a default or small button, so the header keeps its height whether or not the
// page (or the selected tab) has an action: switching tabs doesn't shift the content.
const SettingTabHeader = ({ title, actions, leading }: SettingTabHeaderProps) => (
  <div className="flex min-h-9 w-full items-center justify-between gap-6">
    <div className="flex flex-1 items-center gap-3">
      {leading}
      <div className="text-lg font-semibold leading-7">{title}</div>
    </div>
    {actions && (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
    )}
  </div>
);

/**
 * Every settings page's column, centered: at most 960px of content (max-w-5xl less px-8 each
 * side).
 */
const settingColumnClassName = 'mx-auto w-full max-w-5xl px-4 sm:px-8';

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
  // A grouped view shows the group's title and tab bar. The selected tab's main action sits in
  // the header like any page's. The description is part of the content: it scrolls away with it.
  const groupContext = useContext(SettingTabGroupContext);
  const group = grouped ? groupContext : null;
  const descriptionInline = Boolean(description) && !group;

  return (
    // w-full: in a row (the standalone settings pages) the page fills the space beside the
    // sidebar instead of shrinking to its content.
    <div
      className={cn(
        'teable-setting-tab-shell flex h-full w-full min-w-0 flex-col bg-background',
        className
      )}
    >
      <div className="teable-setting-tab-shell__mobile-header flex shrink-0 items-center gap-3 border-b px-4 py-3 pe-14 sm:hidden">
        {leading}
        <div className="min-w-0 flex-1 text-lg font-semibold leading-7">
          <MobileSettingNavigationTitle enabled={mobileNavigation}>
            {group?.title ?? title}
          </MobileSettingNavigationTitle>
        </div>
      </div>
      <div className="teable-setting-tab-shell__header hidden shrink-0 sm:block">
        {/* pe-12 keeps the actions clear of the dialog's close button. A description right
            under the title starts the content, so the header leaves only its own gap. */}
        <div
          className={cn(
            settingColumnClassName,
            'pt-6 sm:pe-12',
            descriptionInline ? 'pb-1.5' : 'pb-5'
          )}
        >
          <SettingTabHeader title={group?.title ?? title} actions={actions} leading={leading} />
        </div>
      </div>
      {group && (
        <div className={cn(settingColumnClassName, 'shrink-0 pt-4 sm:pt-0')}>{group.tabs}</div>
      )}
      {/* On a phone everything below the title scrolls; from `sm` up the header stays put and
          the content alone scrolls. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto sm:overflow-y-visible">
        {actions && (
          <div
            className={cn(
              settingColumnClassName,
              'flex shrink-0 flex-wrap items-center gap-2 pt-4 sm:hidden'
            )}
          >
            {actions}
          </div>
        )}
        {/* Spaced by a margin, not padding: a sticky header inside (a table's, say) sticks below
            the scroller's padding, where rows would show above it. */}
        <div
          className={cn(
            'teable-setting-tab-shell__content mt-4 flex flex-1 flex-col sm:min-h-0 sm:overflow-y-auto',
            !group && 'sm:mt-0'
          )}
        >
          <div
            className={cn(
              settingColumnClassName,
              'flex-1 shrink-0 pb-[calc(2.5rem+env(safe-area-inset-bottom))]'
            )}
          >
            {description && (
              <div className={cn('text-sm text-muted-foreground', group ? 'pb-4' : 'pb-5')}>
                {description}
              </div>
            )}
            {children}
          </div>
          {footer && <div className={cn(settingColumnClassName, 'pb-6')}>{footer}</div>}
        </div>
      </div>
    </div>
  );
};
