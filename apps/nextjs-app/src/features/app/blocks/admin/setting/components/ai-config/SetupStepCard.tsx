'use client';

import { Check, ChevronDown } from '@teable/icons';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';

interface ISetupStepCardProps {
  title: string;
  description?: string;
  /** Leave undefined for sections that have no completion state. */
  isComplete?: boolean;
  children: ReactNode;
  badge?: ReactNode;
  /** Marks the section as optional, so an unconfigured one shows no pending status. */
  optional?: boolean;
  /** Status shown on the right of the header. */
  aside?: ReactNode;
  /** Pass both to make the body collapsible behind the header (for rarely used sections). */
  isExpanded?: boolean;
  onToggle?: () => void;
  disabled?: boolean;
}

/** A settings section: header with title, description and status, then its form. */
export function SetupStepCard({
  title,
  description,
  isComplete,
  children,
  badge,
  optional,
  aside,
  isExpanded,
  onToggle,
  disabled,
}: Readonly<ISetupStepCardProps>) {
  const { t } = useTranslation('common');
  const collapsible = Boolean(onToggle);
  const open = !collapsible || Boolean(isExpanded);

  const status = isComplete ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/10 dark:text-green-400">
      <Check className="size-3" />
      {t('admin.configuration.completed')}
    </span>
  ) : isComplete === false && !optional ? (
    <span className="inline-flex shrink-0 items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
      {t('admin.setting.ai.guide.incomplete')}
    </span>
  ) : null;

  const header = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-medium">
          {title}
          {optional && (
            <span className="rounded border bg-muted px-1.5 text-xs font-normal text-muted-foreground">
              {t('admin.setting.ai.wizard.optional')}
            </span>
          )}
          {badge}
        </div>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {aside}
        {status}
        {collapsible && (
          <ChevronDown
            className={cn(
              'size-4 text-muted-foreground transition-transform',
              isExpanded && 'rotate-180'
            )}
          />
        )}
      </div>
    </>
  );

  return (
    <section className={cn('rounded-lg border bg-card', disabled && 'opacity-50')}>
      {collapsible ? (
        <button
          type="button"
          className={cn(
            'flex w-full items-start gap-4 rounded-lg px-5 py-4 text-start',
            !disabled && 'hover:bg-muted/50'
          )}
          disabled={disabled}
          aria-expanded={open}
          onClick={onToggle}
        >
          {header}
        </button>
      ) : (
        <div className="flex items-start gap-4 px-5 pt-4">{header}</div>
      )}
      {open && (
        <div className={cn('px-5 pb-5', collapsible ? 'border-t pt-4' : 'pt-4')}>{children}</div>
      )}
    </section>
  );
}

interface ISetupStepperProps {
  steps: { title: string; isComplete: boolean; disabled?: boolean }[];
  current: number;
  onSelect: (index: number) => void;
}

/** Ordered steps; a step stays disabled until the one before it is complete. */
export function SetupStepper({ steps, current, onSelect }: Readonly<ISetupStepperProps>) {
  return (
    // Narrower than 32rem only the current step keeps its title; long titles truncate
    <div className="@container">
      <div className="flex items-center gap-1">
        {steps.map((step, index) => (
          <div
            key={step.title}
            className="flex min-w-0 flex-1 items-center gap-1 last:flex-initial"
          >
            <button
              type="button"
              disabled={step.disabled}
              aria-current={current === index ? 'step' : undefined}
              onClick={() => onSelect(index)}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors',
                current === index ? 'bg-muted font-medium text-foreground' : 'hover:bg-muted/50',
                step.disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent'
              )}
            >
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border text-xs',
                  step.isComplete &&
                    'border-green-600 bg-green-600 text-white dark:border-green-500'
                )}
              >
                {step.isComplete ? <Check className="size-3" /> : index + 1}
              </span>
              <span
                className={cn('truncate', current !== index && 'sr-only @lg:not-sr-only')}
                title={step.title}
              >
                {step.title}
              </span>
            </button>
            {index < steps.length - 1 && <div className="h-px min-w-4 flex-1 bg-border" />}
          </div>
        ))}
      </div>
    </div>
  );
}
