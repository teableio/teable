'use client';

import { Check, ChevronDown } from '@teable/icons';
import { cn, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@teable/ui-lib/shadcn';
import type { ReactNode } from 'react';

interface ISetupStepCardProps {
  title: string;
  description?: string;
  isComplete: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
  icon?: ReactNode;
}

export function SetupStepCard({
  title,
  description,
  isComplete,
  isExpanded,
  onToggle,
  children,
  badge,
  disabled,
  icon,
}: ISetupStepCardProps) {
  return (
    <Collapsible open={isExpanded} onOpenChange={disabled ? undefined : onToggle}>
      <div
        className={cn(
          'rounded-lg border bg-card transition-colors overflow-hidden',
          isExpanded && 'border-primary/50',
          isExpanded && !isComplete && 'border-primary shadow-sm',
          disabled && 'opacity-50'
        )}
      >
        <CollapsibleTrigger asChild disabled={disabled}>
          <button
            className={cn(
              'flex w-full items-center gap-4 p-4 text-left',
              !disabled && 'hover:bg-muted'
            )}
          >
            {/* Step indicator */}
            <div
              className={cn(
                'flex size-7 shrink-0 items-center justify-center border rounded-full text-sm font-medium text-muted-foreground transition-colors',
                isComplete &&
                  'border-green-600 text-green-600 dark:text-green-400 dark:border-green-400'
              )}
            >
              {isComplete ? <Check className="size-4" /> : null}
            </div>

            {/* Title and description */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {icon && <span className="size-4 shrink-0">{icon}</span>}
                <span className="font-medium">{title}</span>
                {badge}
              </div>
              {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
            </div>
            {/* Expand indicator */}
            <ChevronDown
              className={cn(
                'size-5 shrink-0 text-muted-foreground transition-transform',
                isExpanded && 'rotate-180'
              )}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t bg-background p-4">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
