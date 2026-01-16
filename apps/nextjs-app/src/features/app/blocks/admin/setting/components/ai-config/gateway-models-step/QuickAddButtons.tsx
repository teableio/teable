'use client';

import { Plus } from '@teable/icons';
import type { IGatewayModel, GatewayModelProvider } from '@teable/openapi';
import {
  Button,
  Label,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import type { TFunction } from 'next-i18next';
import { GATEWAY_PROVIDER_ICONS } from '../constant';
import type { IGatewayModelAPI } from './types';
import { formatUsdPriceShort, generateLabelFromId, getPricingFromApiModel } from './utils';

// Extract provider from model ID (e.g., "anthropic/claude-sonnet-4.5" -> "anthropic")
function getProviderFromModelId(modelId: string): GatewayModelProvider | undefined {
  const provider = modelId.split('/')[0];
  if (provider && provider in GATEWAY_PROVIDER_ICONS) {
    return provider as GatewayModelProvider;
  }
  return undefined;
}

interface IQuickAddButtonsProps {
  availableRecommendedIds: string[];
  isLoadingModels: boolean;
  findApiModel: (modelId: string) => IGatewayModelAPI | undefined;
  onQuickAdd: (modelId: string) => void;
  onOpenDialog: () => void;
  showPricing: boolean;
  t: TFunction;
}

export function QuickAddButtons({
  availableRecommendedIds,
  isLoadingModels,
  findApiModel,
  onQuickAdd,
  onOpenDialog,
  showPricing,
  t,
}: IQuickAddButtonsProps) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{t('admin.setting.ai.quickAdd')}</Label>
      <div className="mt-2 flex flex-wrap gap-2">
        {isLoadingModels ? (
          // Show skeleton buttons while loading
          <>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-8 w-32 animate-pulse rounded-md bg-muted" />
            ))}
          </>
        ) : (
          availableRecommendedIds.slice(0, 6).map((modelId) => {
            const apiModel = findApiModel(modelId);
            const pricing = getPricingFromApiModel(apiModel);
            const provider = apiModel?.ownedBy || getProviderFromModelId(modelId);
            const ProviderIcon = provider
              ? GATEWAY_PROVIDER_ICONS[provider as keyof typeof GATEWAY_PROVIDER_ICONS]
              : Plus;
            return (
              <TooltipProvider key={modelId}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="outline" onClick={() => onQuickAdd(modelId)}>
                      <ProviderIcon className="size-4" />
                      {apiModel?.name || generateLabelFromId(modelId)}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="text-xs">
                      <div>{modelId}</div>
                      {showPricing && pricing && (
                        <div className="text-muted-foreground">
                          In: {formatUsdPriceShort(pricing.input)} / Out:{' '}
                          {formatUsdPriceShort(pricing.output)}
                        </div>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.preventDefault();
            onOpenDialog();
          }}
        >
          {t('admin.setting.ai.wizard.addCustom')}
        </Button>
      </div>
    </div>
  );
}
