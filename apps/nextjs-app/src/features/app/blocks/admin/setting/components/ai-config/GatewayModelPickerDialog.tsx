'use client';

import type {
  GatewayModelProvider,
  GatewayModelTag,
  GatewayModelType,
  IModelPricing,
} from '@teable/openapi';
import { USD_PER_CREDIT, TOKENS_PER_RATE_UNIT } from '@teable/openapi';
import {
  Badge,
  cn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  ScrollArea,
} from '@teable/ui-lib/shadcn';
import Fuse from 'fuse.js';
import { Check, DollarSign, Loader2, Search, Coins } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GATEWAY_PROVIDER_ICONS } from './constant';

// Capability labels for display
export const CAPABILITY_LABELS: Record<string, string> = {
  image: 'Vision',
  pdf: 'PDF',
  webSearch: 'Web',
  toolCall: 'Tools',
  reasoning: 'Reasoning',
  imageGeneration: 'Image Gen',
};

/**
 * Unified model interface for the picker dialog.
 * This abstracts the differences between API response models and configured models.
 */
export interface IPickerModel {
  id: string;
  name?: string;
  description?: string;
  ownedBy?: GatewayModelProvider;
  modelType?: GatewayModelType;
  tags?: GatewayModelTag[];
  isImageModel?: boolean;
  capabilities?: Record<string, boolean | undefined>;
  // Pricing info from Vercel AI Gateway API (USD per token)
  pricing?: IModelPricing;
}

export type PriceDisplayMode = 'usd' | 'credits' | 'none';

interface IGatewayModelPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: IPickerModel[];
  isLoading?: boolean;
  selectedModelId?: string;
  onSelectModel: (model: IPickerModel) => void;
  title?: string;
  /**
   * Price display mode:
   * - 'usd': Show USD pricing (for admin panel)
   * - 'credits': Show credit pricing (for end-user)
   * - 'none': Don't show pricing
   */
  priceMode?: PriceDisplayMode;
  /**
   * Filter function to exclude certain models (e.g., already added models)
   */
  isModelDisabled?: (model: IPickerModel) => boolean;
  /**
   * Custom badge to show for disabled models
   */
  disabledBadgeText?: string;
  /**
   * Empty state message when no models found
   */
  emptyMessage?: string;
}

/**
 * Convert USD per token to credits per 1M tokens
 * Formula: credits/1M = (USD/token * 1M) / USD_PER_CREDIT
 */
function usdToCreditsPerMillion(usdPerToken: string | undefined): number | undefined {
  if (!usdPerToken) return undefined;
  const usd = parseFloat(usdPerToken);
  if (isNaN(usd) || usd === 0) return 0;
  return (usd * TOKENS_PER_RATE_UNIT) / USD_PER_CREDIT;
}

/**
 * Format credit rate for display (per 1M tokens)
 */
function formatCreditRate(credits: number | undefined, freeLabel: string): string {
  if (credits === undefined) return '-';
  if (credits === 0) return freeLabel;
  if (credits < 1) return credits.toFixed(2);
  if (credits < 100) return credits.toFixed(1);
  return Math.round(credits).toString();
}

// Helper to format USD price for display (per 1M tokens)
function formatUsdPriceShort(price: string | undefined, freeLabel: string): string {
  if (!price) return '-';
  const num = parseFloat(price);
  if (isNaN(num) || num === 0) return freeLabel;
  // Convert to per-million rate for readability
  const perMillion = num * TOKENS_PER_RATE_UNIT;
  if (perMillion < 1) return `$${perMillion.toFixed(2)}/M`;
  if (perMillion < 100) return `$${perMillion.toFixed(1)}/M`;
  return `$${Math.round(perMillion)}/M`;
}

// Generate display label from model ID
function generateLabel(modelId: string, apiName?: string): string {
  if (apiName) return apiName;
  const parts = modelId.split('/');
  const modelName = parts[parts.length - 1];
  return modelName
    .replace(/-\d{8}$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Detect if model is an image model based on type, tags, or ID
function detectIsImageModel(model: IPickerModel): boolean {
  if (model.isImageModel || model.modelType === 'image') return true;
  if (model.tags?.includes('image-generation')) return true;
  return false;
}

export function GatewayModelPickerDialog({
  open,
  onOpenChange,
  models,
  isLoading = false,
  selectedModelId,
  onSelectModel,
  title,
  priceMode = 'none',
  isModelDisabled,
  disabledBadgeText,
  emptyMessage,
}: IGatewayModelPickerDialogProps) {
  const { t } = useTranslation('common');
  const freeLabel = t('level.free');
  const creditsLabel = t('noun.credits');
  const [searchQuery, setSearchQuery] = useState('');
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Scroll to top when search query changes
  useEffect(() => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        viewport.scrollTop = 0;
      }
    }
  }, [searchQuery]);

  // Filter and search models
  const filteredModels = useMemo(() => {
    const filtered = [...models];

    // Sort by created time if available, otherwise by name
    filtered.sort((a, b) => {
      const nameA = generateLabel(a.id, a.name);
      const nameB = generateLabel(b.id, b.name);
      return nameA.localeCompare(nameB);
    });

    // Apply fuzzy search
    if (searchQuery) {
      const fuse = new Fuse(filtered, {
        keys: [
          { name: 'name', weight: 2 },
          { name: 'id', weight: 1.5 },
          { name: 'description', weight: 1 },
        ],
        threshold: 0.4,
        includeScore: true,
        ignoreLocation: true,
      });
      const results = fuse.search(searchQuery);
      return results.map((r) => r.item).slice(0, 50);
    }

    return filtered.slice(0, 100);
  }, [models, searchQuery]);

  // Render price badge based on mode
  // eslint-disable-next-line sonarjs/cognitive-complexity
  const renderPriceBadge = (model: IPickerModel) => {
    if (priceMode === 'none') return null;

    const { pricing } = model;
    const isImage = detectIsImageModel(model);

    if (priceMode === 'usd') {
      // Show USD pricing from API (per 1M tokens for text, per image for images)
      if (!pricing || (!pricing.input && !pricing.output && !pricing.image)) return null;

      return (
        <Badge variant="outline" className="text-[10px]">
          <DollarSign className="mr-0.5 size-2.5" />
          {isImage && pricing.image
            ? t('admin.setting.ai.imageOutput', { credits: `$${pricing.image}/img` })
            : `${t('admin.setting.ai.input', {
                ratio: formatUsdPriceShort(pricing.input, freeLabel),
              })} / ${t('admin.setting.ai.output', {
                ratio: formatUsdPriceShort(pricing.output, freeLabel),
              })}`}
        </Badge>
      );
    }

    if (priceMode === 'credits') {
      // Calculate credits from pricing (USD per token -> credits per 1M tokens)
      // Priority: pricing field > legacy rates field
      if (pricing && (pricing.input || pricing.output || pricing.image)) {
        const inputCredits = usdToCreditsPerMillion(pricing.input);
        const outputCredits = usdToCreditsPerMillion(pricing.output);
        const imageUsd = pricing.image ? parseFloat(pricing.image) : undefined;
        // Image price is per image, convert to credits: USD / USD_PER_CREDIT
        const imageCredits = imageUsd ? imageUsd / USD_PER_CREDIT : undefined;

        return (
          <Badge variant="outline" className="text-[10px]">
            <Coins className="mr-0.5 size-2.5" />
            {isImage && imageCredits !== undefined
              ? `${t('admin.setting.ai.imageOutput', {
                  credits: formatCreditRate(imageCredits, freeLabel),
                })} ${creditsLabel}`
              : `${t('admin.setting.ai.input', {
                  ratio: `${formatCreditRate(inputCredits, freeLabel)}/${'M'} ${creditsLabel}`,
                })} / ${t('admin.setting.ai.output', {
                  ratio: `${formatCreditRate(outputCredits, freeLabel)}/${'M'} ${creditsLabel}`,
                })}`}
          </Badge>
        );
      }
      return null;
    }

    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal>
      <DialogContent className="max-w-max px-4">
        <DialogHeader>
          <DialogTitle>{title || t('admin.setting.ai.moreModels')}</DialogTitle>
        </DialogHeader>

        <div className="flex w-[600px] max-w-[90vw] flex-col gap-4">
          {/* Search Input */}
          <div className="relative px-1">
            <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder={t('admin.setting.ai.searchModelPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-9 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {/* Model List */}
          <ScrollArea ref={scrollAreaRef} className="h-[450px] pr-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {emptyMessage ||
                  (searchQuery
                    ? t('admin.setting.ai.noMatchingModels')
                    : t('admin.setting.ai.noModelsAvailable'))}
              </div>
            ) : (
              <div className="">
                {filteredModels.map((model) => {
                  const isSelected = selectedModelId === model.id;
                  const isDisabled = isModelDisabled?.(model) ?? false;
                  const ProviderIcon = model.ownedBy
                    ? GATEWAY_PROVIDER_ICONS[model.ownedBy as keyof typeof GATEWAY_PROVIDER_ICONS]
                    : undefined;

                  return (
                    <button
                      key={model.id}
                      onClick={() => !isDisabled && onSelectModel(model)}
                      disabled={isDisabled}
                      className={cn(
                        'flex w-full flex-col rounded-sm p-2 py-1.5 text-left transition-colors hover:bg-accent focus:bg-accent focus:outline-none',
                        isSelected && 'bg-accent',
                        isDisabled && 'cursor-not-allowed opacity-50'
                      )}
                    >
                      {/* First row: Icon, Name, Type badges, Check mark */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 truncate">
                          {ProviderIcon && <ProviderIcon className="size-4 shrink-0" />}
                          <span className="truncate text-xs">
                            {generateLabel(model.id, model.name)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {isDisabled && disabledBadgeText && (
                            <Badge variant="secondary" className="text-[10px]">
                              {disabledBadgeText}
                            </Badge>
                          )}
                          {isSelected && <Check className="size-4 shrink-0 text-primary" />}
                        </div>
                      </div>

                      {/* Second row: Model ID, Price badge, Capability badges */}
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <code className="truncate pl-6">{model.id}</code>
                        {/* Price badge */}
                        {renderPriceBadge(model)}
                        {/* Capability badges */}
                        {model.capabilities && (
                          <div className="flex gap-1">
                            {Object.entries(model.capabilities)
                              .filter(([, v]) => v)
                              .slice(0, 3)
                              .map(([key]) => (
                                <Badge key={key} variant="outline" className="text-[10px]">
                                  {CAPABILITY_LABELS[key] || key}
                                </Badge>
                              ))}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
