/* eslint-disable sonarjs/no-duplicate-string */
import { z } from 'zod';

/**
 * Image Model Configuration
 * Based on AI SDK documentation: https://ai-sdk.dev/docs/ai-sdk-core/image-generation
 *
 * This config provides standardized image generation parameters for different providers and models.
 */

// Supported image sizes (width x height)
export const imageSizeSchema = z.enum([
  // Common sizes
  '256x256',
  '512x512',
  '768x768',
  '1024x1024',
  // Wide sizes
  '1024x768',
  '1152x896',
  '1216x832',
  '1280x1024',
  '1344x768',
  '1365x1024',
  '1434x1024',
  '1536x640',
  '1536x1024',
  '1707x1024',
  '1792x1024',
  '1820x1024',
  '2048x1024',
  // Tall sizes
  '768x1344',
  '832x1216',
  '896x1152',
  '640x1536',
  '1024x1280',
  '1024x1344',
  '1024x1365',
  '1024x1434',
  '1024x1536',
  '1024x1707',
  '1024x1792',
  '1024x1820',
  '1024x2048',
]);

export type IImageSize = z.infer<typeof imageSizeSchema>;

// Supported aspect ratios (width : height)
export const aspectRatioSchema = z.enum([
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '9:21',
  '21:9',
  '1:9',
  '3:7',
  '7:3',
]);

export type IAspectRatio = z.infer<typeof aspectRatioSchema>;

// Image quality options
export const imageQualitySchema = z.enum(['standard', 'hd', 'low', 'medium', 'high', 'ultra']);

export type IImageQuality = z.infer<typeof imageQualitySchema>;

// Image style options (OpenAI specific)
export const imageStyleSchema = z.enum(['vivid', 'natural']);

export type IImageStyle = z.infer<typeof imageStyleSchema>;

/**
 * Image model configuration interface
 */
export interface IImageModelConfig {
  /** Provider name */
  provider: string;
  /** Model ID */
  model: string;
  /** Display name */
  displayName?: string;
  /** Whether the model uses sizes or aspect ratios */
  sizeType: 'size' | 'aspectRatio' | 'both' | 'flexible';
  /** Supported sizes (if sizeType is 'size' or 'both') */
  supportedSizes?: IImageSize[];
  /** Supported aspect ratios (if sizeType is 'aspectRatio' or 'both') */
  supportedAspectRatios?: IAspectRatio[];
  /** Default size */
  defaultSize?: IImageSize;
  /** Default aspect ratio */
  defaultAspectRatio?: IAspectRatio;
  /** Maximum images per call */
  maxImagesPerCall?: number;
  /** Whether the model supports quality parameter */
  supportsQuality?: boolean;
  /** Whether the model supports style parameter */
  supportsStyle?: boolean;
  /** Whether the model supports seed parameter */
  supportsSeed?: boolean;
  /** Model type: 'image' for pure image models, 'language' for multimodal LLMs */
  modelType: 'image' | 'language';
  /** Tags for additional capabilities */
  tags?: string[];
  /** Additional notes */
  notes?: string;
}

/**
 * Standard aspect ratios used by most models
 */
export const STANDARD_ASPECT_RATIOS: IAspectRatio[] = [
  '1:1',
  '3:4',
  '4:3',
  '9:16',
  '16:9',
  '9:21',
  '21:9',
];

/**
 * Extended aspect ratios (includes portrait/landscape variants)
 */
export const EXTENDED_ASPECT_RATIOS: IAspectRatio[] = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '9:21',
  '21:9',
];

/**
 * Image model configurations by provider
 * Based on: https://ai-sdk.dev/docs/ai-sdk-core/image-generation#image-models
 */
export const IMAGE_MODEL_CONFIGS: IImageModelConfig[] = [
  // xAI Grok
  {
    provider: 'xai',
    model: 'grok-2-image',
    displayName: 'Grok 2 Image',
    sizeType: 'size',
    supportedSizes: ['1024x768'],
    defaultSize: '1024x768',
    modelType: 'image',
  },

  // OpenAI
  {
    provider: 'openai',
    model: 'gpt-image-1',
    displayName: 'GPT Image 1',
    sizeType: 'size',
    supportedSizes: ['1024x1024', '1536x1024', '1024x1536'],
    defaultSize: '1024x1024',
    supportsQuality: true,
    supportsStyle: true,
    modelType: 'image',
  },
  {
    provider: 'openai',
    model: 'dall-e-3',
    displayName: 'DALL-E 3',
    sizeType: 'size',
    supportedSizes: ['1024x1024', '1792x1024', '1024x1792'],
    defaultSize: '1024x1024',
    maxImagesPerCall: 1,
    supportsQuality: true,
    supportsStyle: true,
    supportsSeed: true,
    modelType: 'image',
  },
  {
    provider: 'openai',
    model: 'dall-e-2',
    displayName: 'DALL-E 2',
    sizeType: 'size',
    supportedSizes: ['256x256', '512x512', '1024x1024'],
    defaultSize: '1024x1024',
    maxImagesPerCall: 10,
    modelType: 'image',
  },

  // Google (Multimodal LLMs with image generation capability)
  {
    provider: 'google',
    model: 'gemini-2.5-flash-image-preview',
    displayName: 'Gemini 2.5 Flash Image Preview',
    sizeType: 'flexible',
    defaultSize: '1024x1024',
    modelType: 'language',
    tags: ['image-generation'],
    notes: 'Multimodal LLM with image generation via generateText',
  },
  {
    provider: 'google',
    model: 'gemini-3-pro-image',
    displayName: 'Gemini 3 Pro Image',
    sizeType: 'flexible',
    modelType: 'language',
    tags: ['image-generation'],
    notes: 'Multimodal LLM with image generation via generateText',
  },
  // Google Imagen
  {
    provider: 'google',
    model: 'imagen-4.0-generate-001',
    displayName: 'Imagen 4.0',
    sizeType: 'aspectRatio',
    supportedAspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
    defaultAspectRatio: '1:1',
    modelType: 'image',
  },
  {
    provider: 'google',
    model: 'imagen-4.0-fast-generate-001',
    displayName: 'Imagen 4.0 Fast',
    sizeType: 'aspectRatio',
    supportedAspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
    defaultAspectRatio: '1:1',
    modelType: 'image',
  },
];

/**
 * Get image model config by provider and model
 */
export function getImageModelConfig(
  provider: string,
  model: string
): IImageModelConfig | undefined {
  return IMAGE_MODEL_CONFIGS.find((c) => c.provider === provider && c.model === model);
}

/**
 * Get image model config by model ID (for gateway models like "google/gemini-2.5-flash-image-preview")
 */
export function getImageModelConfigByGatewayId(
  gatewayModelId: string
): IImageModelConfig | undefined {
  const [provider, ...modelParts] = gatewayModelId.split('/');
  const model = modelParts.join('/');
  return (
    IMAGE_MODEL_CONFIGS.find((c) => c.provider === provider && c.model === model) ||
    IMAGE_MODEL_CONFIGS.find((c) => c.model === gatewayModelId || c.model === model)
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
    (c) => c.modelType === 'language' && c.tags?.includes('image-generation')
  );
}

/**
 * Check if a model supports image generation
 */
export function supportsImageGeneration(modelType?: string, tags?: string[]): boolean {
  if (modelType === 'image') return true;
  if (modelType === 'language' && tags?.includes('image-generation')) return true;
  return false;
}

/**
 * Get default size or aspect ratio for a model
 */
export function getDefaultImageDimension(config: IImageModelConfig): {
  size?: IImageSize;
  aspectRatio?: IAspectRatio;
} {
  if (config.defaultSize) {
    return { size: config.defaultSize };
  }
  if (config.defaultAspectRatio) {
    return { aspectRatio: config.defaultAspectRatio };
  }
  return { size: '1024x1024' };
}

/**
 * Convert aspect ratio to approximate size
 */
export function aspectRatioToSize(aspectRatio: IAspectRatio, baseSize = 1024): IImageSize {
  const [widthRatio, heightRatio] = aspectRatio.split(':').map(Number);
  const ratio = widthRatio / heightRatio;

  let width: number;
  let height: number;

  if (ratio >= 1) {
    width = baseSize;
    height = Math.round(baseSize / ratio);
  } else {
    height = baseSize;
    width = Math.round(baseSize * ratio);
  }

  // Round to nearest multiple of 64 (common requirement for image models)
  width = Math.round(width / 64) * 64;
  height = Math.round(height / 64) * 64;

  return `${width}x${height}` as IImageSize;
}
