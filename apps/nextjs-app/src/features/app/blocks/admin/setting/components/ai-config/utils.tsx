import { DeepThinking, Eye, ImageGeneration, Audio } from '@teable/icons';
import type {
  IGatewayModel,
  IImageModelDefination,
  ISimpleLLMProvider,
  ITextModelDefination,
  LLMProvider,
} from '@teable/openapi';
import { LLMProviderType } from '@teable/openapi';
import type { TFunction } from 'next-i18next';
import type { ReactNode } from 'react';
import { Trans } from 'react-i18next';

// Fixed name for AI Gateway provider in modelKey
export const AI_GATEWAY_PROVIDER_NAME = 'teable';

export const generateModelKeyList = (llmProviders: ISimpleLLMProvider[] | LLMProvider[]) => {
  return llmProviders
    .map((provider) => {
      const { models, type, name, isInstance } = provider;
      const modelConfigs = 'modelConfigs' in provider ? provider.modelConfigs : undefined;
      return models.split(',').map((model) => {
        const config = modelConfigs?.[model];
        return {
          modelKey: `${type}@${model}@${name}`,
          isInstance,
          isImageModel: config?.isImageModel,
          // Use configured label if available, otherwise use model ID
          label: config?.label || model,
          // Include test results from provider config
          capabilities: config?.ability,
          // Include metadata from modelConfigs
          modelType: config?.modelType,
          tags: config?.tags,
          contextWindow: config?.contextWindow,
          maxTokens: config?.maxTokens,
          description: config?.description,
        };
      });
    })
    .flat();
};

/**
 * Generate model key list from gateway models
 * Format: aiGateway@<modelId>@teable
 */
export const generateGatewayModelKeyList = (gatewayModels: IGatewayModel[] | undefined) => {
  if (!gatewayModels) return [];

  return gatewayModels
    .filter((model) => model.enabled)
    .map((model) => ({
      modelKey: `${LLMProviderType.AI_GATEWAY}@${model.id}@${AI_GATEWAY_PROVIDER_NAME}`,
      isInstance: true, // Gateway models are instance-level
      isImageModel: model.isImageModel,
      label: model.label,
      capabilities: model.capabilities,
      isGateway: true,
      pricing: model.pricing, // Pricing format (USD per token)
      // API metadata for enhanced functionality
      ownedBy: model.ownedBy,
      modelType: model.modelType,
      tags: model.tags,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      description: model.description,
    }));
};

/**
 * Check if a modelKey is a gateway model
 */
export const isGatewayModelKey = (modelKey: string): boolean => {
  const { type, name } = parseModelKey(modelKey);
  return (
    type?.toLowerCase() === LLMProviderType.AI_GATEWAY.toLowerCase() &&
    name?.toLowerCase() === AI_GATEWAY_PROVIDER_NAME.toLowerCase()
  );
};

export const parseModelKey = (modelKey: string | undefined) => {
  if (!modelKey) return {};
  const [type, model, name] = modelKey.split('@');
  return { type, model, name };
};

export const decimalToRatio = (decimal: number): string => {
  if (decimal >= 1 || decimal <= 0) return '1:1';

  const decimalStr = decimal.toString();

  const parts = decimalStr.split('.');
  const decimalPlaces = parts[1]?.length || 0;

  const numerator = 1;
  const denominator = Math.ceil(Math.pow(10, decimalPlaces) / Number(decimalStr.replace('.', '')));

  return `${numerator}:${denominator}`;
};

export const isImageOutputModel = (
  modelDefination: IImageModelDefination | ITextModelDefination | undefined
): boolean => {
  return !!(modelDefination && 'outputType' in modelDefination);
};

export const processModelDefinition = (
  modelDefination: IImageModelDefination | ITextModelDefination | undefined,
  t: TFunction
) => {
  if (!modelDefination) return { usageTags: [], featureTags: [] };

  const usageTags: { key: string; text: string; tooltip: ReactNode }[] = [];
  const featureTags: { key: string; tooltip: string; icon: ReactNode }[] = [];

  if ('outputType' in modelDefination) {
    const { usagePerUnit } = modelDefination as IImageModelDefination;
    usageTags.push({
      key: 'output',
      text: t('admin.setting.ai.imageOutput', { credits: usagePerUnit }),
      tooltip: t('admin.setting.ai.imageOutputTip', { credits: usagePerUnit }),
    });

    featureTags.push({
      key: 'imageGeneration',
      tooltip: t('admin.setting.ai.supportImageOutputTip'),
      icon: <ImageGeneration className="size-4" />,
    });
  }

  if ('inputRate' in modelDefination) {
    const { inputRate, outputRate, visionEnable, audioEnable, deepThinkEnable } =
      modelDefination as ITextModelDefination;

    const inputRateRatio = decimalToRatio(inputRate as number);
    const outputRateRatio = decimalToRatio(outputRate as number);

    usageTags.push(
      {
        key: 'input',
        text: t('admin.setting.ai.input', { ratio: inputRateRatio }),
        tooltip: (
          <Trans
            ns="common"
            i18nKey="admin.setting.ai.inputOrOutputTip"
            components={{ br: <br /> }}
          />
        ),
      },
      {
        key: 'output',
        text: t('admin.setting.ai.output', { ratio: outputRateRatio }),
        tooltip: (
          <Trans
            ns="common"
            i18nKey="admin.setting.ai.inputOrOutputTip"
            components={{ br: <br /> }}
          />
        ),
      }
    );

    const featureMap = [
      {
        condition: visionEnable,
        key: 'vision',
        tooltip: t('admin.setting.ai.supportVisionTip'),
        icon: <Eye className="size-4" />,
      },
      {
        condition: audioEnable,
        key: 'audio',
        tooltip: t('admin.setting.ai.supportAudioTip'),
        icon: <Audio className="size-4" />,
      },
      {
        condition: deepThinkEnable,
        key: 'deepThink',
        tooltip: t('admin.setting.ai.supportDeepThinkTip'),
        icon: <DeepThinking className="size-4" />,
      },
    ];

    featureTags.push(
      ...featureMap
        .filter((feature) => feature.condition)
        .map((feature) => ({
          key: feature.key,
          tooltip: feature.tooltip,
          icon: feature.icon,
        }))
    );
  }

  return { usageTags, featureTags };
};
