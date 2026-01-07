import { DollarSign, Loader2 } from '@teable/icons';
import type { LLMProvider, IModelConfig } from '@teable/openapi/src/admin/setting';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState, useCallback } from 'react';
import { parseModelKey } from './utils';

interface IOpenRouterPricing {
  prompt: string;
  completion: string;
  input_cache_read?: string;
  input_cache_write?: string;
  internal_reasoning?: string;
  image?: string;
}

interface IOpenRouterModel {
  id: string;
  name: string;
  pricing: IOpenRouterPricing;
}

interface IFetchPricingProps {
  providers: LLMProvider[];
  onUpdateProviders: (providers: LLMProvider[]) => void;
}

interface IPricingMatch {
  modelKey: string;
  modelName: string;
  openRouterId: string;
  // Basic rates
  inputRate: number;
  outputRate: number;
  // Advanced rates (AI SDK 6)
  cacheReadRate?: number;
  cacheWriteRate?: number;
  reasoningRate?: number;
  imageRate?: number;
  matched: boolean;
}

// OpenRouter model ID patterns for different providers
const PROVIDER_MODEL_PATTERNS: Record<string, (model: string) => string[]> = {
  openai: (model: string) => [`openai/${model}`, model],
  anthropic: (model: string) => [`anthropic/${model}`, model],
  google: (model: string) => [`google/${model}`, model],
  mistral: (model: string) => [`mistralai/${model}`, model],
  deepseek: (model: string) => [`deepseek/${model}`, model],
  xai: (model: string) => [`x-ai/${model}`, `xai/${model}`, model],
  cohere: (model: string) => [`cohere/${model}`, model],
  openrouter: (model: string) => [model],
};

// Convert OpenRouter pricing (per token) to our rate (per 1M tokens in credits)
// OpenRouter prices are in USD per token
// Credit ratio: 1 USD = 100 credits (1 credit = $0.01)
const convertToCredits = (pricePerToken: string): number => {
  const price = parseFloat(pricePerToken || '0');
  // Price per token * 1,000,000 tokens = price per M tokens (in USD)
  // Then convert USD to credits (1 USD = 100 credits)
  // So: price_per_token * 1M * 100 = credits per M tokens
  return price * 1000000 * 100;
};

export const FetchPricing = ({ providers, onUpdateProviders }: IFetchPricingProps) => {
  const { t } = useTranslation('common');
  const [isLoading, setIsLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [matches, setMatches] = useState<IPricingMatch[]>([]);
  const [openRouterModels, setOpenRouterModels] = useState<IOpenRouterModel[]>([]);

  const fetchOpenRouterPricing = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models');
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }
      const data = await response.json();
      const models: IOpenRouterModel[] = data.data || [];
      setOpenRouterModels(models);
      return models;
    } catch (error) {
      toast({
        title: t('admin.setting.ai.fetchPricingError'),
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const findMatchingModel = useCallback(
    (
      providerType: string,
      modelName: string,
      orModels: IOpenRouterModel[]
    ): IOpenRouterModel | null => {
      const patternFn = PROVIDER_MODEL_PATTERNS[providerType.toLowerCase()];
      const patterns = patternFn ? patternFn(modelName) : [modelName];

      // Normalize version: "4-5" → "4.5", "3-7" → "3.7"
      const normalizeVersion = (name: string): string =>
        name.replace(/(\d)-(\d)(?=$|-|:)/g, '$1.$2');

      const normalizedPatterns = patterns.map(normalizeVersion);
      const allPatterns = [...normalizedPatterns, ...patterns];

      // Helper: find by exact ID match
      const findExact = (pattern: string) =>
        orModels.find((m) => m.id.toLowerCase() === pattern.toLowerCase());

      // Helper: find by model suffix match
      const findBySuffix = (pattern: string) =>
        orModels.find((m) => {
          const suffix = m.id.split('/').pop()?.toLowerCase() || '';
          return suffix === pattern.toLowerCase() || suffix.startsWith(pattern.toLowerCase());
        });

      // Helper: find by partial match (contains)
      const findPartial = (pattern: string) =>
        orModels.find((m) => {
          const suffix = m.id.split('/').pop()?.toLowerCase() || '';
          return suffix.includes(pattern.toLowerCase());
        });

      // Try strategies in order of precision
      for (const p of allPatterns) {
        const match = findExact(p) || findBySuffix(p);
        if (match) return match;
      }
      for (const p of allPatterns) {
        const match = findPartial(p);
        if (match) return match;
      }

      return null;
    },
    []
  );

  const handleFetchPricing = useCallback(async () => {
    const models = await fetchOpenRouterPricing();
    if (models.length === 0) return;

    const allMatches: IPricingMatch[] = [];

    providers.forEach((provider) => {
      const modelNames =
        provider.models
          ?.split(',')
          .map((m) => m.trim())
          .filter(Boolean) || [];

      modelNames.forEach((modelName) => {
        const modelKey = `${provider.type}@${modelName}@${provider.name}`;
        const matchedModel = findMatchingModel(provider.type, modelName, models);

        if (matchedModel) {
          const pricing = matchedModel.pricing;
          allMatches.push({
            modelKey,
            modelName,
            openRouterId: matchedModel.id,
            // Basic rates
            inputRate: convertToCredits(pricing.prompt),
            outputRate: convertToCredits(pricing.completion),
            // Advanced rates from AI SDK 6
            cacheReadRate: pricing.input_cache_read
              ? convertToCredits(pricing.input_cache_read)
              : undefined,
            cacheWriteRate: pricing.input_cache_write
              ? convertToCredits(pricing.input_cache_write)
              : undefined,
            reasoningRate: pricing.internal_reasoning
              ? convertToCredits(pricing.internal_reasoning)
              : undefined,
            imageRate: pricing.image ? convertToCredits(pricing.image) : undefined,
            matched: true,
          });
        } else {
          allMatches.push({
            modelKey,
            modelName,
            openRouterId: '',
            inputRate: 0,
            outputRate: 0,
            matched: false,
          });
        }
      });
    });

    setMatches(allMatches);
    setShowDialog(true);
  }, [providers, fetchOpenRouterPricing, findMatchingModel]);

  const handleApplyPricing = useCallback(() => {
    const newProviders = providers.map((provider) => {
      const modelNames =
        provider.models
          ?.split(',')
          .map((m) => m.trim())
          .filter(Boolean) || [];

      const newModelConfigs: Record<string, IModelConfig> = { ...provider.modelConfigs };

      modelNames.forEach((modelName) => {
        const match = matches.find(
          (m) => m.modelKey === `${provider.type}@${modelName}@${provider.name}` && m.matched
        );

        if (match) {
          newModelConfigs[modelName] = {
            ...newModelConfigs[modelName],
            // Basic rates
            inputRate: match.inputRate,
            outputRate: match.outputRate,
            // Advanced rates (only set if available from OpenRouter)
            ...(match.cacheReadRate !== undefined && { cacheReadRate: match.cacheReadRate }),
            ...(match.cacheWriteRate !== undefined && { cacheWriteRate: match.cacheWriteRate }),
            ...(match.reasoningRate !== undefined && { reasoningRate: match.reasoningRate }),
            ...(match.imageRate !== undefined &&
              match.imageRate > 0 && { imageRate: match.imageRate }),
          };
        }
      });

      return {
        ...provider,
        modelConfigs: newModelConfigs,
      };
    });

    onUpdateProviders(newProviders);
    setShowDialog(false);

    const matchedCount = matches.filter((m) => m.matched).length;
    toast({
      title: t('admin.setting.ai.pricingApplied'),
      description: t('admin.setting.ai.pricingAppliedCount', { count: matchedCount }),
    });
  }, [providers, matches, onUpdateProviders, t]);

  const matchedCount = matches.filter((m) => m.matched).length;
  const totalCount = matches.length;

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={handleFetchPricing}
              disabled={isLoading || providers.length === 0}
              className="gap-1"
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <DollarSign className="size-4" />
              )}
              {t('admin.setting.ai.fetchPricing')}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('admin.setting.ai.fetchPricingTip')}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('admin.setting.ai.pricingPreview')}</DialogTitle>
            <DialogDescription>
              {t('admin.setting.ai.pricingPreviewDesc', {
                matched: matchedCount,
                total: totalCount,
              })}
            </DialogDescription>
          </DialogHeader>

          {/* Rate explanation */}
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <p className="font-medium">{t('admin.setting.ai.rateExplanationTitle')}</p>
            <p className="font-mono text-muted-foreground">
              {t('admin.setting.ai.rateExplanationFormula')}
            </p>
            <p className="text-muted-foreground">{t('admin.setting.ai.rateExplanationExample')}</p>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b">
                  <th className="text-left p-2">{t('admin.setting.ai.model')}</th>
                  <th className="text-left p-2">{t('admin.setting.ai.openRouterId')}</th>
                  <th className="text-right p-2">{t('admin.setting.ai.inputRate')}</th>
                  <th className="text-right p-2">{t('admin.setting.ai.outputRate')}</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((match) => (
                  <tr
                    key={match.modelKey}
                    className={`border-b ${match.matched ? '' : 'opacity-50'}`}
                  >
                    <td className="p-2 font-mono text-xs">{match.modelName}</td>
                    <td className="p-2 font-mono text-xs">
                      {match.matched ? (
                        match.openRouterId
                      ) : (
                        <span className="text-muted-foreground italic">
                          {t('admin.setting.ai.notFound')}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-right font-mono text-xs">
                      {match.matched ? match.inputRate.toFixed(0) : '-'}
                    </td>
                    <td className="p-2 text-right font-mono text-xs">
                      {match.matched ? match.outputRate.toFixed(0) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              {t('actions.cancel')}
            </Button>
            <Button onClick={handleApplyPricing} disabled={matchedCount === 0}>
              {t('admin.setting.ai.applyPricing', { count: matchedCount })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
