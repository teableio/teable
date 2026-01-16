import type { IModelDefinationMap } from '@teable/openapi';
import { GATEWAY_PROVIDER_ICONS, LLM_PROVIDER_ICONS } from '../constant';
import { parseModelKey, isGatewayModelKey, isImageOutputModel } from '../utils';
import type { IModelOption } from './types';

/**
 * Parse provider from gateway model ID (e.g., "anthropic/claude-sonnet-4" → "anthropic")
 */
const parseProviderFromModelId = (modelId: string): string | undefined => {
  if (modelId.includes('/')) {
    return modelId.split('/')[0];
  }
  return undefined;
};

/**
 * Get icon component for a model (gateway or standard provider)
 */
export const getModelIcon = (
  modelKey: string,
  ownedBy?: string
): React.ComponentType<{ className?: string }> | undefined => {
  const { type, model } = parseModelKey(modelKey);

  // For gateway models, try to get icon from ownedBy or parse from model ID
  if (isGatewayModelKey(modelKey)) {
    // First try ownedBy if available
    if (ownedBy) {
      const icon = GATEWAY_PROVIDER_ICONS[ownedBy as keyof typeof GATEWAY_PROVIDER_ICONS];
      if (icon) return icon;
    }
    // Fallback: parse provider from model ID (e.g., "anthropic/claude-sonnet-4")
    if (model) {
      const parsedProvider = parseProviderFromModelId(model);
      if (parsedProvider) {
        const icon = GATEWAY_PROVIDER_ICONS[parsedProvider as keyof typeof GATEWAY_PROVIDER_ICONS];
        if (icon) return icon;
      }
    }
  }

  // For standard providers, use LLM_PROVIDER_ICONS
  return LLM_PROVIDER_ICONS[type as keyof typeof LLM_PROVIDER_ICONS];
};

/**
 * Convert USD per token pricing to credits display string
 * 1 credit = $0.01
 */
export const formatPriceToCredits = (
  pricing:
    | {
        input?: string;
        output?: string;
        image?: string;
      }
    | undefined
): string => {
  if (!pricing) return '';

  // Convert USD per token to credits per 1M tokens
  const usdToCredits = (usd: string | undefined) => {
    if (!usd) return 0;
    const val = parseFloat(usd);
    if (isNaN(val) || val === 0) return 0;
    // Convert USD per token to credits per 1M tokens
    return Math.round((val * 1_000_000) / 0.01);
  };

  // For image pricing
  if (pricing.image) {
    const imgCredits = Math.round(parseFloat(pricing.image) / 0.01);
    return `${imgCredits} credits/img`;
  }

  // For text pricing
  const inputCredits = usdToCredits(pricing.input);
  const outputCredits = usdToCredits(pricing.output);
  return `${inputCredits}/${outputCredits} credits/1M`;
};

/**
 * Check if a model option is an image generation model
 */
export const checkIsImageModel = (
  option: IModelOption,
  modelDefinationMap?: IModelDefinationMap
): boolean => {
  const { modelKey, isImageModel, modelType, tags } = option;
  if (isImageModel || modelType === 'image') return true;
  if (tags?.includes('image-generation')) return true;
  const { model = '' } = parseModelKey(modelKey);
  const modelDefination = modelDefinationMap?.[model];
  return isImageOutputModel(modelDefination);
};

/**
 * Check if a model option is a language model
 */
export const checkIsLanguageModel = (
  option: IModelOption,
  modelDefinationMap?: IModelDefinationMap
): boolean => {
  const { modelType, tags } = option;
  // If model has image-generation tag, it's not a pure language model
  // (e.g., gemini-3-pro-image is a multimodal model primarily for image generation)
  if (tags?.includes('image-generation')) return false;
  // If modelType is explicitly set, use it
  if (modelType) return modelType === 'language';
  // If no modelType, it's a language model if it's not an image model
  return !checkIsImageModel(option, modelDefinationMap);
};
