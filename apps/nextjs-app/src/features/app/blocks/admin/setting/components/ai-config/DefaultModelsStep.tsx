'use client';

import { Zap, MessageSquare, Star, HelpCircle } from '@teable/icons';
import {
  DEFAULT_MODEL_TIER,
  formatCreditRatio,
  getDefaultModelTier,
  MODEL_TIER_IDS,
} from '@teable/openapi';
import type { IAIConfig, IModelTierCreditRatio, IModelTierId } from '@teable/openapi';
import {
  Button,
  cn,
  RadioGroup,
  RadioGroupItem,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import type { IModelOption } from './AiModelSelect';
import { AIModelSelect } from './AiModelSelect';

export type IChatModel = NonNullable<IAIConfig['chatModel']>;

interface IDefaultModelsStepProps {
  chatModel?: IChatModel;
  models: IModelOption[];
  /** Credit ratio of each saved tier against the default tier, computed by the server. */
  tierCreditRatio?: IModelTierCreditRatio;
  onChange: (chatModel: IChatModel) => void;
  disabled?: boolean;
  agentRoutingSlot?: ReactNode;
}

export function DefaultModelsStep({
  chatModel,
  models,
  tierCreditRatio,
  onChange,
  disabled,
  agentRoutingSlot,
}: Readonly<IDefaultModelsStepProps>) {
  const { t } = useTranslation('common');

  // Filter to only text models (not image models)
  const textModels = models.filter((m) => !m.isImageModel);

  // Find a recommended default (first gateway model, or first model)
  const recommendedDefault = textModels.find((m) => m.isGateway) || textModels[0];

  const lgModelLabel = useMemo(() => {
    if (!chatModel?.lg) return '';
    const m = textModels.find((m) => m.modelKey === chatModel.lg);
    return m?.label || chatModel.lg;
  }, [chatModel?.lg, textModels]);

  const inheritPlaceholder = useMemo(
    () => t('admin.setting.ai.chatModels.inheritHint', { model: lgModelLabel }),
    [t, lgModelLabel]
  );

  const handleUseRecommended = useCallback(() => {
    if (recommendedDefault) {
      onChange({
        ...chatModel,
        lg: recommendedDefault.modelKey,
      });
    }
  }, [recommendedDefault, chatModel, onChange]);

  const handleTierChange = useCallback(
    (tier: IModelTierId, value: string) => {
      const next: IChatModel = {
        ...chatModel,
        [tier]: tier === DEFAULT_MODEL_TIER ? value : value || undefined,
      };
      // Clear md/sm if they were inheriting from the old lg
      if (tier === DEFAULT_MODEL_TIER) {
        if (chatModel?.md === chatModel?.lg) next.md = undefined;
        if (chatModel?.sm === chatModel?.lg) next.sm = undefined;
      }
      // An unset Ultra is not offered, so it cannot stay the default
      if (tier === 'xl' && !value && chatModel?.defaultTier === tier) next.defaultTier = undefined;
      onChange(next);
    },
    [chatModel, onChange]
  );

  const handleToggleHidden = useCallback(
    (tier: IModelTierId, hidden: boolean) => {
      const others = (chatModel?.hiddenTiers ?? []).filter((id) => id !== tier);
      onChange({ ...chatModel, hiddenTiers: hidden ? [...others, tier] : others });
    },
    [chatModel, onChange]
  );

  // The default tier is always offered, so it leaves the hidden list
  const handleDefaultChange = useCallback(
    (tier: IModelTierId) => {
      onChange({
        ...chatModel,
        defaultTier: tier,
        hiddenTiers: (chatModel?.hiddenTiers ?? []).filter((id) => id !== tier),
      });
    },
    [chatModel, onChange]
  );

  const defaultTier = getDefaultModelTier(chatModel);

  if (disabled) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {t('admin.setting.ai.wizard.completeStep2First')}
        </p>
      </div>
    );
  }

  if (textModels.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {t('admin.setting.ai.wizard.noModelsAvailable')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Quick Setup - only show if no model selected */}
      {recommendedDefault && !chatModel?.lg && (
        <div className="rounded-lg border bg-muted p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Star className="size-4 shrink-0 text-primary" />
                {t('admin.setting.ai.wizard.quickSetup')}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('admin.setting.ai.wizard.useRecommendedDesc', {
                  model: recommendedDefault.label || recommendedDefault.modelKey,
                })}
              </p>
            </div>
            <Button onClick={handleUseRecommended} size="sm" className="shrink-0">
              {t('admin.setting.ai.wizard.useRecommended')}
            </Button>
          </div>
        </div>
      )}

      {/* Model tiers: the size slots users pick from in chat */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <MessageSquare className="size-4" />
          {t('admin.setting.ai.wizard.chatModels')}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="size-3.5 cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>{t('admin.setting.ai.wizard.chatModelTip')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('admin.setting.ai.chatModels.tiersIntro')}
        </p>

        <RadioGroup
          value={defaultTier}
          onValueChange={(tier) => handleDefaultChange(tier as IModelTierId)}
          className="flex flex-col gap-4 rounded-md border bg-muted/30 p-4"
        >
          {MODEL_TIER_IDS.map((tier) => {
            const isMain = tier === DEFAULT_MODEL_TIER;
            const isDefault = tier === defaultTier;
            const hidden = chatModel?.hiddenTiers?.includes(tier) ?? false;
            // The credit badge chat users see on this tier, as saved; cloud only, the server decides
            const creditRatio = formatCreditRatio(tierCreditRatio?.[tier]);
            // lg / md / sm also serve other features; say so next to the tier name
            const backgroundNote =
              tier === 'lg'
                ? t('admin.setting.ai.chatModels.lgBackground')
                : tier === 'md'
                  ? t('admin.setting.ai.chatModels.mdBackground')
                  : tier === 'sm'
                    ? t('admin.setting.ai.chatModels.smBackground')
                    : undefined;
            return (
              <div key={tier} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t(`modelTier.${tier}.label`)}</span>
                  {creditRatio && (
                    <span
                      className={cn(
                        'shrink-0 rounded-md px-2 py-0.5 text-xs leading-5',
                        tier === 'xl'
                          ? 'bg-cyan-50 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {creditRatio}
                    </span>
                  )}
                  {backgroundNote && (
                    <span className="truncate text-xs text-muted-foreground">{backgroundNote}</span>
                  )}
                  <label className="ms-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <RadioGroupItem value={tier} disabled={tier === 'xl' && !chatModel?.xl} />
                    {isDefault
                      ? t('admin.setting.ai.chatModels.defaultTier')
                      : t('admin.setting.ai.chatModels.setDefault')}
                  </label>
                  <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {t('admin.setting.ai.enabled')}
                    <Switch
                      checked={!hidden}
                      disabled={isDefault}
                      onCheckedChange={(checked) => handleToggleHidden(tier, !checked)}
                    />
                  </label>
                </div>
                <AIModelSelect
                  value={chatModel?.[tier] || ''}
                  onValueChange={(value) => handleTierChange(tier, value)}
                  options={textModels}
                  className="w-full"
                  placeholder={
                    tier === 'xl'
                      ? t('admin.setting.ai.chatModels.notOffered')
                      : isMain
                        ? undefined
                        : inheritPlaceholder
                  }
                />
              </div>
            );
          })}
        </RadioGroup>
      </div>

      {/* Status */}
      {chatModel?.lg && (
        <div className="flex h-8 items-center justify-center gap-2 rounded-md bg-green-100 p-2 text-sm text-green-600 dark:bg-green-500/10 dark:text-green-400">
          <Zap className="size-4" />
          {t('admin.setting.ai.wizard.readyToUse')}
        </div>
      )}

      {agentRoutingSlot}
    </div>
  );
}
