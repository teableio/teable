/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { Check, Eye, Image, Loader2, Play, X } from '@teable/icons';
import type {
  IChatModelAbility,
  IImageModelAbility,
  ITestLLMVo,
  LLMProvider,
} from '@teable/openapi/src/admin/setting';
import {
  Button,
  cn,
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
  onTest?: (data: Required<LLMProvider>) => Promise<ITestLLMVo>;
  modelTestResults?: Map<string, IModelTestResult>;
  onToggleImageModel?: (modelKey: string, isImageModel: boolean) => void;
  onTestProvider?: (provider: LLMProvider) => void;
  testingProviders?: Set<string>;
  /** Hide model rates config (for space-level settings where billing doesn't apply) */
  hideModelRates?: boolean;
}

export const LLMProviderManage = ({
  value,
  onChange,
  onTest,
  modelTestResults,
  onToggleImageModel,
  onTestProvider,
  testingProviders,
  hideModelRates,
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
    return <NewLLMProviderForm onAdd={handleAdd} onTest={onTest} hideModelRates={hideModelRates} />;
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
              className="group rounded-lg border p-3 hover:border-primary/50"
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
                            variant="ghost"
                            onClick={() => onTestProvider?.(provider)}
                            disabled={isTesting}
                            className="h-6 gap-1 px-2 text-xs"
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
                <div className="flex shrink-0 gap-1 opacity-70">
                  <Button
                    onClick={() => handleRemove(index)}
                    size="xs"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100"
                  >
                    <XIcon className="size-4" />
                  </Button>
                  <UpdateLLMProviderForm
                    value={provider}
                    onChange={handleUpdate(index)}
                    onTest={onTest}
                    hideModelRates={hideModelRates}
                  >
                    <Button size="xs" variant="ghost">
                      <SlidersHorizontalIcon className="size-4" />
                    </Button>
                  </UpdateLLMProviderForm>
                </div>
              </div>

              {/* Model pills */}
              {models.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {models.map((model) => {
                    const modelKey = `${provider.type}@${model}@${provider.name}`;
                    const testResult = modelTestResults?.get(modelKey);
                    const isImageModel = provider.modelConfigs?.[model]?.isImageModel;
                    return (
                      <ModelPill
                        key={modelKey}
                        model={model}
                        modelKey={modelKey}
                        testResult={testResult}
                        isImageModel={isImageModel}
                        onToggleImageModel={onToggleImageModel}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        <NewLLMProviderForm onAdd={handleAdd} onTest={onTest} hideModelRates={hideModelRates} />
      </div>
    </div>
  );
};

interface IModelPillProps {
  model: string;
  modelKey: string;
  testResult?: IModelTestResult;
  isImageModel?: boolean;
  onToggleImageModel?: (modelKey: string, isImageModel: boolean) => void;
}

const ModelPill = ({
  model,
  modelKey,
  testResult,
  isImageModel,
  onToggleImageModel,
}: IModelPillProps) => {
  const { t } = useTranslation('common');
  const status = testResult?.status || 'idle';

  const getImageSupportStatus = () => {
    if (!testResult?.ability?.image) return 'none';
    const { url, base64 } = testResult.ability.image as { url?: boolean; base64?: boolean };
    if (url && base64) return 'full';
    if (url || base64) return 'partial';
    return 'none';
  };

  const getImageModelStatus = () => {
    if (!testResult?.imageAbility) return null;
    const { generation, imageToImage } = testResult.imageAbility;
    if (generation && imageToImage) return 'full';
    if (generation || imageToImage) return 'partial';
    return 'none';
  };

  const imageStatus = status === 'success' && !isImageModel ? getImageSupportStatus() : null;
  const imageModelStatus = status === 'success' && isImageModel ? getImageModelStatus() : null;

  const getStatusStyles = () => {
    switch (status) {
      case 'idle':
        return 'bg-muted/50 text-muted-foreground border-transparent';
      case 'pending':
        return 'bg-muted/70 text-muted-foreground border-transparent';
      case 'testing':
        return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-800';
      case 'success':
        return 'bg-green-100 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-400 dark:border-green-800';
      case 'failed':
        return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800';
    }
  };

  const getImageIcon = () => {
    // For text models: show vision support
    if (!isImageModel) {
      if (imageStatus === 'full') {
        return <Eye className="size-3 text-green-600 dark:text-green-400" />;
      }
      if (imageStatus === 'partial') {
        return <Eye className="size-3 text-yellow-600 dark:text-yellow-400" />;
      }
      if (imageStatus === 'none') {
        return <Eye className="size-3 opacity-30" />;
      }
    }
    // For image models: show generation support
    if (isImageModel) {
      if (imageModelStatus === 'full') {
        return <Image className="size-3 text-green-600 dark:text-green-400" />;
      }
      if (imageModelStatus === 'partial') {
        return <Image className="size-3 text-yellow-600 dark:text-yellow-400" />;
      }
      if (imageModelStatus === 'none') {
        return <Image className="size-3 opacity-30" />;
      }
      // Show image icon for image models even if not tested
      return <Image className="size-3 text-purple-500" />;
    }
    return null;
  };

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const tooltipContent = () => {
    const lines: string[] = [modelKey];

    if (isImageModel) {
      lines.push('🎨 Image Generation Model');
    }

    if (status === 'failed' && testResult?.error) {
      lines.push(`Error: ${testResult.error}`);
    }

    if (status === 'success') {
      if (isImageModel && testResult?.imageAbility) {
        const { generation, imageToImage } = testResult.imageAbility;
        lines.push(`Generation: ${generation ? '✓' : '✗'}`);
        lines.push(`Image-to-Image: ${imageToImage ? '✓' : '✗'}`);
      } else if (!isImageModel) {
        const { url, base64 } =
          (testResult?.ability?.image as { url?: boolean; base64?: boolean }) || {};
        if (imageStatus === 'full') {
          lines.push(`Vision: ✓ URL, ✓ Base64`);
        } else if (imageStatus === 'partial') {
          lines.push(`Vision: ${url ? '✓' : '✗'} URL, ${base64 ? '✓' : '✗'} Base64`);
        } else {
          lines.push(`Vision: Not supported`);
        }
      }
    }

    lines.push(t('admin.setting.ai.clickToToggleImageModel'));
    return lines;
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newIsImageModel = !isImageModel;
    onToggleImageModel?.(modelKey, newIsImageModel);

    // Show friendly toast notification
    if (newIsImageModel) {
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

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            onClick={handleClick}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors hover:opacity-80',
              getStatusStyles(),
              isImageModel && 'ring-1 ring-purple-400 dark:ring-purple-600'
            )}
          >
            <span className="max-w-[100px] truncate">{model}</span>

            {/* Status indicator */}
            {status === 'testing' && <Loader2 className="size-3 animate-spin" />}
            {status === 'success' && <Check className="size-3" />}
            {status === 'failed' && <X className="size-3" />}

            {/* Image support indicator */}
            {getImageIcon()}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-0.5">
            {tooltipContent().map((line, i) => (
              <p key={i} className="break-all text-xs">
                {line}
              </p>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
