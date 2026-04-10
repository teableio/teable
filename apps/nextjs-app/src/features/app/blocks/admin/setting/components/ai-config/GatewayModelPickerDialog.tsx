'use client';

import type {
  GatewayModelProvider,
  GatewayModelTag,
  GatewayModelType,
  IModelPricing,
} from '@teable/openapi';
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
import { Check, Loader2, Search } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  calculateMultiplier,
  formatMultiplier,
  formatPriceToCredits,
} from './ai-model-select/utils';
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

export type PriceDisplayMode = 'usd' | 'multiplier' | 'none';

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
      return results.map((r) => r.item);
    }

    return filtered;
  }, [models, searchQuery]);

  // Render price badge based on mode
  // eslint-disable-next-line sonarjs/cognitive-complexity
  const renderPriceBadge = (model: IPickerModel) => {
    if (priceMode === 'none') return null;

    const { pricing } = model;
    const isImage = detectIsImageModel(model);

    if (priceMode === 'usd') {
      if (isImage) {
        const creditLabel = formatPriceToCredits(pricing) || freeLabel;
        return (
          <Badge variant="outline" className="text-[10px]">
            {creditLabel}
          </Badge>
        );
      }
      if (!pricing || (!pricing.input && !pricing.output)) return null;
      const ratio = calculateMultiplier(pricing);
      const label = formatMultiplier(ratio);
      if (!label) return null;
      return (
        <Badge variant="outline" className="text-[10px]">
          {label}
        </Badge>
      );
    }

    if (priceMode === 'multiplier') {
      if (isImage) {
        const creditLabel = formatPriceToCredits(pricing) || freeLabel;
        return (
          <Badge variant="outline" className="text-[10px]">
            {creditLabel}
          </Badge>
        );
      }
      const ratio = calculateMultiplier(pricing);
      const label = formatMultiplier(ratio) ?? freeLabel;

      return (
        <Badge variant="outline" className="text-[10px]">
          {label}
        </Badge>
      );
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
