'use client';

import { ChevronDown } from '@teable/icons';
import { Button } from '@teable/ui-lib';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { ComponentPropsWithoutRef } from 'react';
import { forwardRef } from 'react';
import { parseModelKey } from '../utils';
import type { IModelOption } from './types';
import { getModelIcon } from './utils';

interface IModelSelectTriggerProps extends ComponentPropsWithoutRef<typeof Button> {
  currentModel: IModelOption | undefined;
  value: string;
  open: boolean;
}

/**
 * Trigger button for model select dropdown
 */
export const ModelSelectTrigger = forwardRef<HTMLButtonElement, IModelSelectTriggerProps>(
  ({ currentModel, value, size = 'default', className, open, ...props }, ref) => {
    const { t } = useTranslation('common');
    const { name, model } = parseModelKey(currentModel?.modelKey || value);
    const Icon = getModelIcon(currentModel?.modelKey || value, currentModel?.ownedBy);
    // Display name priority: label (configured name) > model (ID) > name (provider name)
    const displayName = currentModel?.label || model || name;

    return (
      <Button
        ref={ref}
        variant="outline"
        role="combobox"
        aria-expanded={open}
        size={size}
        className={cn('grow justify-between font-normal flex', className)}
        {...props}
      >
        <div className="flex flex-1 items-center truncate">
          {!currentModel ? (
            t('admin.setting.ai.selectModel')
          ) : (
            <>
              {Icon && <Icon className="mr-1.5 size-4 shrink-0" />}
              <span className="truncate" title={model}>
                {displayName}
              </span>
            </>
          )}
        </div>
        <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
      </Button>
    );
  }
);

ModelSelectTrigger.displayName = 'ModelSelectTrigger';
