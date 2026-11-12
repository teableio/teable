import { cn, Input } from '@teable/ui-lib/shadcn';
import { Search } from 'lucide-react';
import type { ComponentProps, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { createContext, useContext } from 'react';

/*
 * Building blocks of a settings page. Every section is one card; the variant decides the inside:
 * things people add and remove (connections, tokens, members, providers) are a `list`, split by
 * hairlines; settings and read-only facts are `plain`, separated by whitespace alone.
 */

type SettingSectionVariant = 'plain' | 'list';

const SettingSectionContext = createContext<SettingSectionVariant>('plain');

/** Stacks a page's sections, 32px apart. */
export const SettingStack = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => <div className={cn('flex flex-col gap-8', className)}>{children}</div>;

interface ISettingSectionProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Right of the title: the section's own "+ Add" (outline) and secondary buttons. */
  actions?: ReactNode;
  /** Above the content, under the title: a `SettingToolbar`. */
  toolbar?: ReactNode;
  variant?: SettingSectionVariant;
  /** Danger zone: the title turns destructive; it goes last on the page. */
  danger?: boolean;
  /** Renders the children as they are, with no frame (card grids, steps, tables with their own). */
  bare?: boolean;
  className?: string;
  children?: ReactNode;
}

export const SettingSection = ({
  title,
  description,
  actions,
  toolbar,
  variant = 'plain',
  danger,
  bare,
  className,
  children,
}: ISettingSectionProps) => (
  <section className={cn('flex min-w-0 flex-col gap-2', className)}>
    {(title || description || actions) && (
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        {/* ps-1: the title sits a little in from the card's rounded edge, so it lines up with
            the card's contents rather than its corner. */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 ps-1">
          {title && (
            <h3 className={cn('text-sm font-semibold', danger && 'text-destructive')}>{title}</h3>
          )}
          {description && <div className="text-sm text-muted-foreground">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    )}
    {toolbar}
    {children != null &&
      (bare ? (
        children
      ) : (
        <SettingSectionContext.Provider value={variant}>
          <div
            className={cn(
              'rounded-lg border bg-card',
              variant === 'list' ? 'divide-y' : 'flex flex-col px-4 py-2'
            )}
          >
            {children}
          </div>
        </SettingSectionContext.Provider>
      ))}
  </section>
);

interface ISettingItemProps {
  label: ReactNode;
  /** The id of the row's own field, so the label focuses it. */
  htmlFor?: string;
  description?: ReactNode;
  /** The control, right-aligned. Text inputs and selects are `w-full sm:w-64`. */
  action?: ReactNode;
  /** Keeps the control beside the text on phones too (a switch, a short button). */
  inline?: boolean;
  /**
   * A setting that only applies when the one above is on: indented, with a regular-weight muted
   * label, so it reads as part of that one rather than a setting of its own.
   */
  indent?: boolean;
  className?: string;
}

/** A setting: label and description on the left, its control on the right. */
export const SettingItem = ({
  label,
  htmlFor,
  description,
  action,
  inline,
  indent,
  className,
}: ISettingItemProps) => {
  const list = useContext(SettingSectionContext) === 'list';
  const labelClassName = cn('text-sm', indent ? 'text-muted-foreground' : 'font-medium');
  return (
    <div
      className={cn(
        'flex gap-3',
        inline
          ? 'items-center justify-between gap-6'
          : 'flex-col items-stretch sm:flex-row sm:items-center sm:justify-between sm:gap-6',
        list ? 'px-4 py-3' : 'py-2',
        indent && (list ? 'ps-10' : 'ps-6'),
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className={labelClassName}>
            {label}
          </label>
        ) : (
          <div className={labelClassName}>{label}</div>
        )}
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
};

/** The 36px tile that leads an item row: a logo, an avatar or an icon. */
export const SettingItemIcon = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => (
  <div
    className={cn(
      'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background text-muted-foreground [&_svg]:size-4',
      className
    )}
  >
    {children}
  </div>
);

interface ISettingListItemProps {
  /** Wrapped in a `SettingItemIcon`. */
  icon?: ReactNode;
  /** A custom leading element, used instead of `icon`. */
  media?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** A line of small facts under the title: usage, dates, chips. */
  meta?: ReactNode;
  /** At most one text button, then a "⋯" menu for the rest. */
  actions?: ReactNode;
  /** A child of the row above (an account under its app, a model under its provider). */
  nested?: boolean;
  onClick?: () => void;
  className?: string;
}

/** One thing in a list: what it is, a few facts, and what you can do to it. */
export const SettingListItem = ({
  icon,
  media,
  title,
  description,
  meta,
  actions,
  nested,
  onClick,
  className,
}: ISettingListItemProps) => (
  <div
    className={cn(
      'flex items-center gap-3 px-4 py-3',
      nested && 'bg-muted ps-16',
      onClick && 'cursor-pointer hover:bg-accent',
      className
    )}
    onClick={onClick}
    onKeyDown={
      onClick
        ? (e) => {
            if (e.key === 'Enter' && e.target === e.currentTarget) onClick();
          }
        : undefined
    }
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
  >
    {media ?? (icon && <SettingItemIcon>{icon}</SettingItemIcon>)}
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium">{title}</div>
      {description && <div className="text-xs text-muted-foreground">{description}</div>}
      {meta && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {meta}
        </div>
      )}
    </div>
    {actions && (
      // Keep clicks on the buttons (and their menus, which bubble through portals) from opening
      // the row.
      <div
        role="toolbar"
        tabIndex={-1}
        className="flex shrink-0 items-center gap-1"
        onClick={(e: MouseEvent) => e.stopPropagation()}
        onKeyDown={(e: KeyboardEvent) => e.stopPropagation()}
      >
        {actions}
      </div>
    )}
  </div>
);

/** Above a list: search first, then filters, then (after a spacer) a count or note on the right. */
export const SettingToolbar = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>;

export const SettingToolbarSpacer = () => <div className="flex-1" />;

export const SettingToolbarNote = ({ children }: { children: ReactNode }) => (
  <span className="whitespace-nowrap text-xs text-muted-foreground">{children}</span>
);

export const SettingSearchInput = ({ className, ...props }: ComponentProps<typeof Input>) => (
  <div className={cn('relative w-full sm:w-64', className)}>
    <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    <Input className="h-8 ps-8" {...props} />
  </div>
);

/** A placeholder for an empty list: one sentence and, if any, the way to add the first item. */
export const SettingEmpty = ({
  icon,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      'flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground [&>svg]:size-5',
      className
    )}
  >
    {icon}
    <div>{children}</div>
    {action}
  </div>
);

export interface ISettingStep {
  title: ReactNode;
  content?: ReactNode;
}

/** Numbered steps: a ring with the number, the step's title, then what to do. */
export const SettingSteps = ({
  steps,
  className,
}: {
  steps: ISettingStep[];
  className?: string;
}) => (
  <ol className={cn('flex flex-col gap-6', className)}>
    {steps.map((step, index) => (
      <li key={index} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3">
        <span className="flex size-6 items-center justify-center rounded-full border text-xs font-semibold tabular-nums">
          {index + 1}
        </span>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="text-sm font-medium leading-6">{step.title}</div>
          {step.content && (
            <div className="flex min-w-0 flex-col gap-3 text-sm text-muted-foreground">
              {step.content}
            </div>
          )}
        </div>
      </li>
    ))}
  </ol>
);
