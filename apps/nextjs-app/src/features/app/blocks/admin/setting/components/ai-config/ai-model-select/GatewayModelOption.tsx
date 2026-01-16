'use client';

import {
  cn,
  CommandItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { Check } from 'lucide-react';
import { parseModelKey } from '../utils';
import type { IModelOption } from './types';
import { formatPriceToCredits, getModelIcon } from './utils';

interface IGatewayModelOptionProps {
  option: IModelOption;
  isSelected: boolean;
  showPrice: boolean;
  onSelect: (modelKey: string, isSelected: boolean) => void;
}

/**
 * Gateway model option with full tooltip (context, tokens, tags, pricing)
 */
export function GatewayModelOption({
  option,
  isSelected,
  showPrice,
  onSelect,
}: IGatewayModelOptionProps) {
  const { modelKey, label, pricing, contextWindow, maxTokens, tags, ownedBy } = option;
  const { model } = parseModelKey(modelKey);
  const displayName = label || model;
  const hasPrice = pricing?.input || pricing?.output || pricing?.image;
  const Icon = getModelIcon(modelKey, ownedBy);

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
              <span className="max-w-[280px] truncate font-medium">{displayName}</span>
            </div>
          </CommandItem>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <div className="space-y-1.5 text-xs">
            <code className="block rounded bg-muted px-1 py-0.5">{model}</code>
            {/* Context & Tokens */}
            {(contextWindow || maxTokens) && (
              <div className="flex gap-2 text-muted-foreground">
                {contextWindow && <span>Context: {(contextWindow / 1000).toFixed(0)}k</span>}
                {maxTokens && <span>Max: {(maxTokens / 1000).toFixed(0)}k</span>}
              </div>
            )}
            {/* Tags */}
            {tags && tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="rounded bg-muted px-1 py-0.5 text-[10px]">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {/* Pricing (only show when showPrice is true - for Cloud) */}
            {showPrice && hasPrice && (
              <div className="text-muted-foreground">{formatPriceToCredits(pricing)}</div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
