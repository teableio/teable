/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { Check, Loader2, Play, X } from '@teable/icons';
import { chatModelAbilityType } from '@teable/openapi';
import type {
  IChatModelAbility,
  IImageModelAbility,
  ITestLLMRo,
  ITestLLMVo,
  LLMProvider,
} from '@teable/openapi';

// Image model ability types
const imageModelAbilities = ['generation', 'imageToImage'] as const;
import {
  Button,
  Checkbox,
  cn,
  Label,
  toast,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';

import { NewLLMProviderForm, UpdateLLMProviderForm } from './LlmProviderForm';

// Model test result interface
export interface IModelTestResult {
  modelKey: string;
  status: 'idle' | 'pending' | 'testing' | 'success' | 'failed';
  error?: string;
  ability?: IChatModelAbility;
  imageAbility?: IImageModelAbility;
  isImageModel?: boolean;
}

interface ILLMProviderManageProps {
  value: LLMProvider[];
  onChange: (value: LLMProvider[]) => void;
  /** Test function - accepts full ITestLLMRo for capability testing */
  onTest?: (data: ITestLLMRo) => Promise<ITestLLMVo>;
  modelTestResults?: Map<string, IModelTestResult>;
  onToggleImageModel?: (modelKey: string, isImageModel: boolean) => void;
  onTestProvider?: (provider: LLMProvider) => void;
  onTestModel?: (provider: LLMProvider, model: string, modelKey: string) => Promise<void>;
  testingProviders?: Set<string>;
  testingModels?: Set<string>;
  /** Hide model rates config (for space-level settings where billing doesn't apply) */
  hideModelRates?: boolean;
  /** Callback to save model test results */
  onSaveTestResult?: (
    modelKey: string,
    ability: IChatModelAbility | undefined,
    imageAbility: IImageModelAbility | undefined
  ) => void;
}

export const LLMProviderManage = ({
  value,
  onChange,
  onTest,
  modelTestResults,
  onToggleImageModel,
  onTestProvider,
  onTestModel,
  testingProviders,
  testingModels,
  hideModelRates,
  onSaveTestResult,
}: ILLMProviderManageProps) => {
  const { t } = useTranslation('common');
  const handleAdd = (data: LLMProvider) => {
    const newData = [...value, data];
    onChange(newData);
  };

  const handleUpdate = (index: number) => (data: LLMProvider) => {
    const newData = value.map((provider, i) => (i === index ? data : provider));
    onChange(newData);
  };

  const handleRemove = (index: number) => {
    const newData = value.filter((_, i) => i !== index);
    onChange(newData);
  };

  if (value.length === 0) {
    return (
      <NewLLMProviderForm
        onAdd={handleAdd}
        onTest={onTest}
        hideModelRates={hideModelRates}
        onSaveTestResult={onSaveTestResult}
      />
    );
  }

  return (
    <div>
      <div className="flex w-full flex-col gap-3">
        {value.map((provider, index) => {
          // Get models for this provider
          const models =
            provider.models
              ?.split(',')
              .map((m) => m.trim())
              .filter(Boolean) || [];
          const providerKey = `${provider.type}@${provider.name}`;
          const isTesting = testingProviders?.has(providerKey);

          return (
            <div
              className="group rounded-lg border p-4 pr-3 hover:border-primary/50"
              key={provider.name}
            >
              {/* Provider header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {provider.name} - {provider.type}
                  </span>
                  {models.length > 0 && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => onTestProvider?.(provider)}
                            disabled={isTesting}
                            className="h-6 gap-1 px-2 text-xs shadow-none"
                          >
                            {isTesting ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Play className="size-3" />
                            )}
                            {isTesting
                              ? t('admin.setting.ai.testing')
                              : t('admin.setting.ai.testProvider')}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t('admin.setting.ai.testProviderTooltip', { count: models.length })}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    onClick={() => handleRemove(index)}
                    size="xs"
                    variant="ghost"
                    className="w-7 p-0 opacity-0 group-hover:opacity-100"
                  >
                    <XIcon className="size-4 text-muted-foreground" />
                  </Button>
                  <UpdateLLMProviderForm
                    value={provider}
                    onChange={handleUpdate(index)}
                    onTest={onTest}
                    hideModelRates={hideModelRates}
                    onSaveTestResult={onSaveTestResult}
                  >
                    <Button size="xs" variant="ghost" className="w-7 p-0">
                      <SlidersHorizontalIcon className="size-4 text-muted-foreground" />
                    </Button>
                  </UpdateLLMProviderForm>
                </div>
              </div>

              {/* Model rows - each model on its own line with capabilities */}
              {models.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  {models.map((model) => {
                    const modelKey = `${provider.type}@${model}@${provider.name}`;
                    const testResult = modelTestResults?.get(modelKey);
                    const isImageModel = provider.modelConfigs?.[model]?.isImageModel;
                    const isModelTesting = testingModels?.has(modelKey);
                    return (
                      <ModelRow
                        key={modelKey}
                        model={model}
                        modelKey={modelKey}
                        testResult={testResult}
                        isImageModel={isImageModel}
                        onToggleImageModel={onToggleImageModel}
                        onTestModel={
                          onTestModel ? () => onTestModel(provider, model, modelKey) : undefined
                        }
                        isTesting={isModelTesting}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        <NewLLMProviderForm
          onAdd={handleAdd}
          onTest={onTest}
          hideModelRates={hideModelRates}
          onSaveTestResult={onSaveTestResult}
        />
      </div>
    </div>
  );
};

interface IModelRowProps {
  model: string;
  modelKey: string;
  testResult?: IModelTestResult;
  isImageModel?: boolean;
  onToggleImageModel?: (modelKey: string, isImageModel: boolean) => void;
  onTestModel?: () => Promise<void>;
  isTesting?: boolean;
}

// Helper to check if ability is supported (handles both boolean and detailed format)
const isAbilitySupported = (
  ability: boolean | { url?: boolean; base64?: boolean } | undefined
): boolean => {
  if (typeof ability === 'boolean') return ability;
  if (ability && typeof ability === 'object') {
    return ability.url === true || ability.base64 === true;
  }
  return false;
};

// Helper to get support details for display
const getAbilitySupportDetails = (
  ability: boolean | { url?: boolean; base64?: boolean } | undefined
): string | null => {
  if (typeof ability === 'boolean') return null;
  if (ability && typeof ability === 'object') {
    const parts: string[] = [];
    if (ability.url) parts.push('URL');
    if (ability.base64) parts.push('Base64');
    return parts.length > 0 ? parts.join(', ') : null;
  }
  return null;
};

const ModelRow = ({
  model,
  modelKey,
  testResult,
  isImageModel,
  onToggleImageModel,
  onTestModel,
  isTesting,
}: IModelRowProps) => {
  const { t } = useTranslation('common');
  const status = testResult?.status || 'idle';
  const isCurrentlyTesting = isTesting || status === 'testing';

  const handleCheckboxChange = (checked: boolean) => {
    onToggleImageModel?.(modelKey, checked);

    // Show friendly toast notification
    if (checked) {
      toast({
        title: `🎨 ${model}`,
        description: t('admin.setting.ai.markedAsImageModel'),
      });
    } else {
      toast({
        title: `💬 ${model}`,
        description: t('admin.setting.ai.markedAsTextModel'),
      });
    }
  };

  // Get abilities to display based on model type
  const textAbilities = chatModelAbilityType.options;
  const imgAbilities = imageModelAbilities;

  // Get ability value from test result for text models
  const getTextAbilityValue = (abilityType: (typeof textAbilities)[number]) => {
    return testResult?.ability?.[abilityType];
  };

  // Get ability value from test result for image models
  const getImageAbilityValue = (abilityType: (typeof imgAbilities)[number]) => {
    return testResult?.imageAbility?.[abilityType];
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'testing':
        return <Loader2 className="size-3.5 animate-spin text-blue-500" />;
      case 'success':
        return <Check className="size-3.5 text-green-500" />;
      case 'failed':
        return <X className="size-3.5 text-red-500" />;
      default:
        return null;
    }
  };

  return (
    <div className="rounded-md border bg-muted p-3">
      {/* Model header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Model name with status */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{model}</span>
            {getStatusIcon()}
            {status === 'failed' && testResult?.error && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs text-red-500">
                      ({t('admin.setting.ai.testFailed')})
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">{testResult.error}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {/* Test button for single model */}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => onTestModel?.()}
            disabled={isCurrentlyTesting}
            className="h-5 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
          >
            {isCurrentlyTesting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Play className="size-3" />
            )}
            {t('admin.setting.ai.testProvider')}
          </Button>
        </div>

        {/* Image model checkbox */}
        <div className="flex items-center gap-2">
          <Checkbox
            id={`image-model-${modelKey}`}
            checked={isImageModel}
            onCheckedChange={handleCheckboxChange}
            className="size-4 border-muted-foreground/50 data-[state=checked]:border-purple-500 data-[state=checked]:bg-purple-500"
          />
          <Label
            htmlFor={`image-model-${modelKey}`}
            className="cursor-pointer text-xs text-muted-foreground"
          >
            {t('admin.setting.ai.imageGenerationModel')}
          </Label>
        </div>
      </div>

      {/* Capability badges */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <TooltipProvider>
          {isImageModel
            ? // Image model abilities
              imgAbilities.map((abilityType) => {
                const abilityValue = getImageAbilityValue(abilityType);
                const supported = abilityValue === true;
                const tested = status === 'success';

                return (
                  <div
                    key={abilityType}
                    className={cn(
                      'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors',
                      tested && supported
                        ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-500'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {tested && supported && <Check className="size-2.5" />}
                    <span>{t(`admin.setting.ai.imageModelAbility.${abilityType}`)}</span>
                  </div>
                );
              })
            : // Text model abilities
              textAbilities.map((abilityType) => {
                const abilityValue = getTextAbilityValue(abilityType);
                const supported = isAbilitySupported(abilityValue);
                const supportDetails = getAbilitySupportDetails(abilityValue);
                const tested = status === 'success';

                const badge = (
                  <div
                    className={cn(
                      'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors',
                      tested && supported
                        ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-500'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {tested && supported && <Check className="size-2.5" />}
                    <span>{t(`admin.setting.ai.chatModelAbility.${abilityType}`)}</span>
                    {tested && supportDetails && (
                      <span className="ml-0.5 opacity-70">({supportDetails})</span>
                    )}
                  </div>
                );

                // Show tooltip with details for image/pdf
                if (tested && supportDetails) {
                  return (
                    <Tooltip key={abilityType}>
                      <TooltipTrigger asChild>{badge}</TooltipTrigger>
                      <TooltipContent>
                        <p>
                          {t('admin.setting.ai.chatModelAbility.supportedFormats')}:{' '}
                          {supportDetails}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  );
                }

                return <div key={abilityType}>{badge}</div>;
              })}
        </TooltipProvider>
      </div>
    </div>
  );
};
