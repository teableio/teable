'use client';

import { Zap, MessageSquare, Star, HelpCircle } from '@teable/icons';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo, useState } from 'react';
import type { IModelOption } from './AiModelSelect';
import { AIModelSelect } from './AiModelSelect';

interface IChatModel {
  lg?: string;
  md?: string;
  sm?: string;
}

interface IDefaultModelsStepProps {
  chatModel?: IChatModel;
  models: IModelOption[];
  onChange: (chatModel: IChatModel) => void;
  disabled?: boolean;
}

export function DefaultModelsStep({
  chatModel,
  models,
  onChange,
  disabled,
}: IDefaultModelsStepProps) {
  const { t } = useTranslation('common');
  const [tiersOpen, setTiersOpen] = useState(
    () =>
      Boolean(chatModel?.md && chatModel.md !== chatModel?.lg) ||
      Boolean(chatModel?.sm && chatModel.sm !== chatModel?.lg)
  );

  const customizedCount = useMemo(() => {
    let count = 0;
    if (chatModel?.md && chatModel.md !== chatModel?.lg) count++;
    if (chatModel?.sm && chatModel.sm !== chatModel?.lg) count++;
    return count;
  }, [chatModel?.lg, chatModel?.md, chatModel?.sm]);

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

  const handleLgChange = useCallback(
    (value: string) => {
      const next: IChatModel = { ...chatModel, lg: value };
      // Clear md/sm if they were inheriting from the old lg
      if (chatModel?.md === chatModel?.lg) next.md = undefined;
      if (chatModel?.sm === chatModel?.lg) next.sm = undefined;
      onChange(next);
    },
    [chatModel, onChange]
  );

  const handleMdChange = useCallback(
    (value: string) => {
      onChange({ ...chatModel, md: value || undefined });
    },
    [chatModel, onChange]
  );

  const handleSmChange = useCallback(
    (value: string) => {
      onChange({ ...chatModel, sm: value || undefined });
    },
    [chatModel, onChange]
  );

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

      {/* Model Selection */}
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

        <AIModelSelect
          value={chatModel?.lg || ''}
          onValueChange={handleLgChange}
          options={textModels}
          className="w-full"
        />

        {/* Model tiers - collapsible */}
        {chatModel?.lg && (
          <Collapsible open={tiersOpen} onOpenChange={setTiersOpen}>
            <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ChevronRight
                className={cn('size-4 shrink-0 transition-transform', tiersOpen && 'rotate-90')}
              />
              <span>{t('admin.setting.ai.chatModels.modelTiers')}</span>
              {!tiersOpen && (
                <span className="ml-1 text-xs opacity-60">
                  {customizedCount > 0
                    ? t('admin.setting.ai.chatModels.customized', { count: customizedCount })
                    : t('admin.setting.ai.chatModels.allInheriting')}
                </span>
              )}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 text-xs text-muted-foreground">
                {t('admin.setting.ai.chatModels.modelTiersDescription')}
              </div>
              <div className="mt-3 flex flex-col gap-4 rounded-md border bg-muted/30 p-4">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium">
                      {t('admin.setting.ai.chatModels.md')}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('admin.setting.ai.chatModels.mdDescription')}
                    </span>
                  </div>
                  <AIModelSelect
                    value={chatModel?.md || ''}
                    onValueChange={handleMdChange}
                    options={textModels}
                    className="w-full"
                    placeholder={inheritPlaceholder}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium">
                      {t('admin.setting.ai.chatModels.sm')}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('admin.setting.ai.chatModels.smDescription')}
                    </span>
                  </div>
                  <AIModelSelect
                    value={chatModel?.sm || ''}
                    onValueChange={handleSmChange}
                    options={textModels}
                    className="w-full"
                    placeholder={inheritPlaceholder}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {/* Status */}
      {chatModel?.lg && (
        <div className="flex h-8 items-center justify-center gap-2 rounded-md bg-green-100 p-2 text-sm text-green-600 dark:bg-green-500/10 dark:text-green-400">
          <Zap className="size-4" />
          {t('admin.setting.ai.wizard.readyToUse')}
        </div>
      )}
    </div>
  );
}
