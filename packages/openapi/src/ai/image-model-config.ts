import { z } from 'zod';
import type { IImageModelAbility } from '../admin';
import { supportsImageInputForImageGeneration } from './image-generation-input-capability';
import { IMAGE_MODEL_CONFIGS } from './image-model-catalog';
import {
  DEFAULT_IMAGE_SIZE_CANDIDATES,
  getImageAspectRatioCandidates,
  getImageSizeCandidates,
} from './image-model-dimensions';
import type { IImageModelConfig } from './image-model-types';
export {
  getImageGenerationInputMode,
  ImageGenerationInputMode,
  supportsImageEditPromptForImageGeneration,
  supportsImageInputForImageGeneration,
} from './image-generation-input-capability';
export { IMAGE_MODEL_CONFIGS } from './image-model-catalog';
export {
  DEFAULT_ASPECT_RATIO_CANDIDATES,
  DEFAULT_IMAGE_SIZE_CANDIDATES,
  aspectRatioToSize,
  aspectRatioSchema,
  getDefaultImageDimension,
  getImageAspectRatioCandidates,
  getImageSizeCandidates,
  imageSizeSchema,
  isAspectRatioSupported,
  isImageSizeSupported,
} from './image-model-dimensions';
export type {
  IAspectRatio,
  IDefaultImageDimensionConfig,
  IImageAspectRatioRange,
  IImageSize,
  IImageSizeRange,
} from './image-model-dimensions';
export type { IImageModelConfig } from './image-model-types';

/**
 * Image Model Configuration
 * Based on AI SDK documentation: https://ai-sdk.dev/docs/ai-sdk-core/image-generation
 *
 * This config provides standardized image generation parameters for different providers and models.
 */

// Image quality options
export const imageQualitySchema = z.enum(['standard', 'hd', 'low', 'medium', 'high', 'ultra']);

export type IImageQuality = z.infer<typeof imageQualitySchema>;

// Image style options (OpenAI specific)
export const imageStyleSchema = z.enum(['vivid', 'natural']);

export type IImageStyle = z.infer<typeof imageStyleSchema>;

const AI_GATEWAY_MODEL_KEY_TYPE = 'aiGateway';
const IMAGE_GENERATION_TAG = 'image-generation';

/**
 * Get image model config by provider and model
 */
export function getImageModelConfig(
  provider: string,
  model: string
): IImageModelConfig | undefined {
  return IMAGE_MODEL_CONFIGS.find((c) => c.provider === provider && c.model === model);
}

const getUniqueImageModelConfigByModel = (model: string): IImageModelConfig | undefined => {
  const matches = IMAGE_MODEL_CONFIGS.filter((c) => c.model === model);
  return matches.length === 1 ? matches[0] : undefined;
};

/**
 * Get image model config by model ID (for gateway models like "google/gemini-2.5-flash-image-preview")
 */
export function getImageModelConfigByGatewayId(
  gatewayModelId: string
): IImageModelConfig | undefined {
  const [provider, ...modelParts] = gatewayModelId.split('/');
  const model = modelParts.join('/');

  if (!model) {
    return getUniqueImageModelConfigByModel(gatewayModelId);
  }

  const providerModelMatch = IMAGE_MODEL_CONFIGS.find(
    (c) => c.provider === provider && c.model === model
  );
  if (providerModelMatch) {
    return providerModelMatch;
  }

  const fullModelIdMatch = IMAGE_MODEL_CONFIGS.find((c) => c.model === gatewayModelId);
  if (fullModelIdMatch) {
    return fullModelIdMatch;
  }

  // Only fall back to bare model IDs when the catalog has a single owner for that model.
  return (
    getUniqueImageModelConfigByModel(model) ?? getUniqueImageModelConfigByModel(gatewayModelId)
  );
}

/**
 * Get all image models for a provider
 */
export function getImageModelsByProvider(provider: string): IImageModelConfig[] {
  return IMAGE_MODEL_CONFIGS.filter((c) => c.provider === provider);
}

/**
 * Get all pure image models (modelType === 'image')
 */
export function getPureImageModels(): IImageModelConfig[] {
  return IMAGE_MODEL_CONFIGS.filter((c) => c.modelType === 'image');
}

/**
 * Get all multimodal LLMs with image generation capability
 */
export function getMultimodalImageModels(): IImageModelConfig[] {
  return IMAGE_MODEL_CONFIGS.filter(
    (c) => c.modelType === 'language' && c.tags?.includes(IMAGE_GENERATION_TAG)
  );
}

/**
 * Check if a model supports image generation
 */
export function supportsImageGeneration(modelType?: string, tags?: readonly string[]): boolean {
  if (modelType === 'image') return true;
  if (modelType === 'language' && tags?.includes(IMAGE_GENERATION_TAG)) return true;
  return false;
}

export interface IImageModelMetadata {
  id: string;
  type?: string;
  modelType?: string;
  tags?: readonly string[];
}

export interface IResolvedImageModelConfig {
  config: IImageModelConfig;
  modelId: string;
  tags: string[];
}

const mergeTags = (...tagGroups: Array<readonly string[] | undefined>): string[] => [
  ...new Set(tagGroups.flatMap((tags) => tags ?? [])),
];

const splitModelId = (modelId: string): Pick<IImageModelConfig, 'provider' | 'model'> => {
  const [provider, ...modelParts] = modelId.split('/');
  const model = modelParts.join('/');

  if (!provider || !model) {
    return { provider: 'custom', model: modelId };
  }

  return { provider, model };
};

const createGenericImageModelConfig = (
  modelId: string,
  tags: readonly string[] = []
): IImageModelConfig => ({
  ...splitModelId(modelId),
  displayName: modelId,
  sizeType: 'size',
  supportedSizes: DEFAULT_IMAGE_SIZE_CANDIDATES,
  defaultSize: '1024x1024',
  supportsQuality: true,
  modelType: 'image',
  tags: mergeTags(tags),
});

const createPromptControlledImageModelConfig = (
  modelId: string,
  tags: readonly string[] = []
): IImageModelConfig => ({
  ...splitModelId(modelId),
  displayName: modelId,
  sizeType: 'flexible',
  modelType: 'language',
  tags: mergeTags(tags, [IMAGE_GENERATION_TAG]),
});

const getModelTypeFromMetadata = (metadata?: IImageModelMetadata) =>
  metadata?.modelType ?? metadata?.type;

const getLegacyImageModelConfig = (modelId: string): IImageModelConfig | undefined => {
  if (modelId.toLowerCase().includes('gemini')) {
    return createPromptControlledImageModelConfig(modelId);
  }
  return undefined;
};

export function getImageModelIdFromModelKey(modelKey?: string): string | undefined {
  if (!modelKey) return undefined;

  const [type, model] = modelKey.split('@');
  if (!type || !model) return undefined;

  return type === AI_GATEWAY_MODEL_KEY_TYPE ? model : `${type}/${model}`;
}

export function getImageModelCatalogId(config: Pick<IImageModelConfig, 'provider' | 'model'>) {
  return `${config.provider}/${config.model}`;
}

export function isPromptControlledImageGenerationModel(config: IImageModelConfig): boolean {
  return config.modelType === 'language' && (config.tags?.includes(IMAGE_GENERATION_TAG) ?? false);
}

export function supportsImageSizeSelection(config: IImageModelConfig): boolean {
  return (
    config.modelType === 'image' &&
    ['size', 'both', 'flexible'].includes(config.sizeType) &&
    getImageSizeCandidates(config).length > 0
  );
}

export function supportsImageAspectRatioSelection(config: IImageModelConfig): boolean {
  return (
    isPromptControlledImageGenerationModel(config) ||
    (['aspectRatio', 'both', 'flexible'].includes(config.sizeType) &&
      getImageAspectRatioCandidates(config).length > 0)
  );
}

export function supportsImageCountSelection(config: IImageModelConfig): boolean {
  return config.maxImagesPerCall !== 1;
}

export function supportsImageInputForImageModel(
  config: IImageModelConfig,
  modelId = getImageModelCatalogId(config),
  tags: readonly string[] = config.tags ?? []
): boolean {
  return (
    isPromptControlledImageGenerationModel(config) ||
    supportsImageInputForImageGeneration(modelId, tags)
  );
}

export function supportsKnownImageInputForImageModel(
  providerType: string | undefined,
  model: string | undefined
): boolean {
  if (!providerType || !model) return false;

  const config =
    providerType === AI_GATEWAY_MODEL_KEY_TYPE
      ? getImageModelConfigByGatewayId(model)
      : getImageModelConfig(providerType, model);
  if (!config) return false;

  return supportsImageInputForImageModel(config, getImageModelCatalogId(config), config.tags);
}

export function getKnownImageModelAbility(
  providerType: string | undefined,
  model: string | undefined
): IImageModelAbility | undefined {
  if (!providerType || !model) return undefined;

  const config =
    providerType === AI_GATEWAY_MODEL_KEY_TYPE
      ? getImageModelConfigByGatewayId(model)
      : getImageModelConfig(providerType, model);
  if (!config || !supportsImageGeneration(config.modelType, config.tags)) return undefined;

  return {
    generation: true,
    imageToImage: supportsImageInputForImageModel(
      config,
      getImageModelCatalogId(config),
      config.tags
    ),
  };
}

export function getImageModelConfigByModelKey(
  modelKey?: string,
  gatewayModels: readonly IImageModelMetadata[] = []
): IResolvedImageModelConfig | undefined {
  const modelId = getImageModelIdFromModelKey(modelKey);
  if (!modelId) return undefined;

  const gatewayModel = gatewayModels.find((model) => model.id === modelId);
  const gatewayTags = gatewayModel?.tags ?? [];
  const catalogConfig = getImageModelConfigByGatewayId(modelId);
  if (catalogConfig) {
    const tags = mergeTags(catalogConfig.tags, gatewayTags);
    const config = { ...catalogConfig, tags };
    return { config, modelId: getImageModelCatalogId(config), tags };
  }

  const gatewayModelType = getModelTypeFromMetadata(gatewayModel);
  if (gatewayModelType === 'language' && gatewayTags.includes(IMAGE_GENERATION_TAG)) {
    const config = createPromptControlledImageModelConfig(modelId, gatewayTags);
    return { config, modelId: getImageModelCatalogId(config), tags: config.tags ?? [] };
  }

  if (gatewayModelType === 'image') {
    const config = createGenericImageModelConfig(modelId, gatewayTags);
    return { config, modelId: getImageModelCatalogId(config), tags: config.tags ?? [] };
  }

  const legacyConfig = getLegacyImageModelConfig(modelId);
  if (!legacyConfig) return undefined;

  return {
    config: legacyConfig,
    modelId: getImageModelCatalogId(legacyConfig),
    tags: legacyConfig.tags ?? [],
  };
}
