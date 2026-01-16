'use client';

import { Zap, MessageSquare, Star, HelpCircle } from '@teable/icons';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useCallback } from 'react';
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

  // Filter to only text models (not image models)
  const textModels = models.filter((m) => !m.isImageModel);

  // Find a recommended default (first gateway model, or first model)
  const recommendedDefault = textModels.find((m) => m.isGateway) || textModels[0];

  const handleUseRecommended = useCallback(() => {
    if (recommendedDefault) {
      // Set the same model for all sizes
      onChange({
        lg: recommendedDefault.modelKey,
        md: recommendedDefault.modelKey,
        sm: recommendedDefault.modelKey,
      });
    }
  }, [recommendedDefault, onChange]);

  const handleModelChange = useCallback(
    (value: string) => {
      // Set all sizes to the same model for simplicity
      onChange({
        lg: value,
        md: value,
        sm: value,
      });
    },
    [onChange]
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

      {/* Model Selection - simplified to one model */}
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
          onValueChange={handleModelChange}
          options={textModels}
          className="w-full"
        />
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
