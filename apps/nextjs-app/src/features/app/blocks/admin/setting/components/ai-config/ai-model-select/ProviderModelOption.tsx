'use client';

import type { IModelDefinationMap } from '@teable/openapi';
import {
  cn,
  CommandItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { Check } from 'lucide-react';
import type { TFunction } from 'next-i18next';
import { LLM_PROVIDER_ICONS } from '../constant';
import { parseModelKey, processModelDefinition } from '../utils';
import type { IModelOption } from './types';

interface IProviderModelOptionProps {
  option: IModelOption;
  isSelected: boolean;
  onSelect: (modelKey: string, isSelected: boolean) => void;
  /** Model definition map for price info (instance models only) */
  modelDefinationMap?: IModelDefinationMap;
  /** Translation function for price info */
  t?: TFunction;
  /** Whether to show detailed price info (for instance models) */
  showPriceInfo?: boolean;
}

/**
 * Provider model option (space or instance) with simple tooltip
 */
export function ProviderModelOption({
  option,
  isSelected,
  onSelect,
  modelDefinationMap,
  t,
  showPriceInfo = false,
}: IProviderModelOptionProps) {
  const { modelKey, label } = option;
  const { type, model } = parseModelKey(modelKey);
  const Icon = LLM_PROVIDER_ICONS[type as keyof typeof LLM_PROVIDER_ICONS];
  const displayName = label || model;

  // Get price info for instance models
  const priceInfo =
    showPriceInfo && modelDefinationMap && t
      ? (() => {
          const modelDefination = modelDefinationMap[model as string];
          const { usageTags } = processModelDefinition(modelDefination, t);
          return usageTags
            .map(({ text }) => text)
            .filter(Boolean)
            .join(' | ');
        })()
      : '';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <CommandItem
            value={modelKey}
            onSelect={(key) => {
              onSelect(key, isSelected);
            }}
          >
            <div className="flex items-center">
              <Check className={cn('mr-2 size-4', isSelected ? 'opacity-100' : 'opacity-0')} />
              {Icon && <Icon className="mr-1.5 size-4 shrink-0" />}
              <span className="max-w-[280px] truncate">{displayName}</span>
            </div>
          </CommandItem>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <div className="space-y-1 text-xs">
            <code className="block rounded bg-muted px-1 py-0.5">{model}</code>
            {priceInfo && <div className="text-muted-foreground">{priceInfo}</div>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
