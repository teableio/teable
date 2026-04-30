/* eslint-disable sonarjs/no-duplicate-string */
import {
  BFL_ASPECT_RATIO_PRESETS,
  BFL_ASPECT_RATIO_RANGE,
  DEEPINFRA_STABILITY_ASPECT_RATIOS,
  DIMENSION_RANGE_256_1440_MULTIPLE_32,
  FIREWORKS_1024_SIZES,
  FIREWORKS_FLUX_ASPECT_RATIOS,
  GEMINI_IMAGE_ASPECT_RATIOS,
  GOOGLE_IMAGEN_ASPECT_RATIOS,
  OPENAI_DALLE2_SIZES,
  OPENAI_DALLE3_SIZES,
  OPENAI_GPT_IMAGE_2_SIZES,
  OPENAI_GPT_IMAGE_SIZES,
  REPLICATE_FLUX_SCHNELL_ASPECT_RATIOS,
  REPLICATE_RECRAFT_SIZES,
  STANDARD_ASPECT_RATIOS,
  TOGETHERAI_SQUARE_SIZES,
  XAI_GROK_ASPECT_RATIOS,
} from './image-model-dimensions';
import type { IAspectRatio, IImageSize } from './image-model-dimensions';
import type { IImageModelConfig } from './image-model-types';

const createAspectRatioImageModel = (
  provider: string,
  model: string,
  displayName: string,
  supportedAspectRatios: IAspectRatio[] = STANDARD_ASPECT_RATIOS
): IImageModelConfig => ({
  provider,
  model,
  displayName,
  sizeType: 'aspectRatio',
  supportedAspectRatios,
  defaultAspectRatio: '1:1',
  modelType: 'image',
});

const createSizeImageModel = (
  provider: string,
  model: string,
  displayName: string,
  supportedSizes: IImageSize[],
  defaultSize: IImageSize = supportedSizes[0]
): IImageModelConfig => ({
  provider,
  model,
  displayName,
  sizeType: 'size',
  supportedSizes,
  defaultSize,
  modelType: 'image',
});

const createOpenAIGptImageModel = (
  model: string,
  displayName: string,
  supportedSizes: IImageSize[] = OPENAI_GPT_IMAGE_SIZES
): IImageModelConfig => ({
  provider: 'openai',
  model,
  displayName,
  sizeType: 'size',
  supportedSizes,
  defaultSize: '1024x1024',
  supportsQuality: true,
  supportsStyle: true,
  modelType: 'image',
  tags: ['image-generation'],
});

const createGeminiImageLanguageModel = (model: string, displayName: string): IImageModelConfig => ({
  provider: 'google',
  model,
  displayName,
  sizeType: 'flexible',
  supportedAspectRatios: GEMINI_IMAGE_ASPECT_RATIOS,
  modelType: 'language',
  tags: ['image-generation'],
  notes: 'Multimodal LLM with image generation via generateText',
});

const createDimensionRangeImageModel = (
  provider: string,
  model: string,
  displayName: string,
  sizeRange: NonNullable<IImageModelConfig['sizeRange']>
): IImageModelConfig => ({
  provider,
  model,
  displayName,
  sizeType: 'flexible',
  sizeRange,
  modelType: 'image',
});

const createBflImageModel = (model: string, displayName: string): IImageModelConfig => ({
  provider: 'bfl',
  model,
  displayName,
  sizeType: 'aspectRatio',
  supportedAspectRatios: BFL_ASPECT_RATIO_PRESETS,
  aspectRatioRange: BFL_ASPECT_RATIO_RANGE,
  defaultAspectRatio: '1:1',
  modelType: 'image',
});

const createRecraftImageModel = (model: string, displayName: string): IImageModelConfig =>
  createSizeImageModel('recraft', model, displayName, REPLICATE_RECRAFT_SIZES);

/**
 * Image model configurations by provider
 * Based on: https://ai-sdk.dev/docs/ai-sdk-core/image-generation#image-models
 */
export const IMAGE_MODEL_CONFIGS: IImageModelConfig[] = [
  // xAI Grok
  {
    provider: 'xai',
    model: 'grok-imagine-image',
    displayName: 'Grok Imagine Image',
    sizeType: 'aspectRatio',
    supportedAspectRatios: XAI_GROK_ASPECT_RATIOS,
    supportsAutoAspectRatio: true,
    defaultAspectRatio: '1:1',
    modelType: 'image',
  },

  // OpenAI
  createOpenAIGptImageModel('gpt-image-2', 'GPT Image 2', OPENAI_GPT_IMAGE_2_SIZES),
  createOpenAIGptImageModel('gpt-image-1.5', 'GPT Image 1.5'),
  createOpenAIGptImageModel('gpt-image-1-mini', 'GPT Image 1 Mini'),
  createOpenAIGptImageModel('gpt-image-1', 'GPT Image 1'),
  {
    provider: 'openai',
    model: 'dall-e-3',
    displayName: 'DALL-E 3',
    sizeType: 'size',
    supportedSizes: OPENAI_DALLE3_SIZES,
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
    supportedSizes: OPENAI_DALLE2_SIZES,
    defaultSize: '1024x1024',
    maxImagesPerCall: 10,
    modelType: 'image',
  },

  // Amazon Bedrock
  {
    provider: 'amazonBedrock',
    model: 'amazon.nova-canvas-v1:0',
    displayName: 'Amazon Nova Canvas',
    sizeType: 'both',
    sizeRange: {
      min: 320,
      max: 4096,
      multipleOf: 16,
      maxPixels: 4_200_000,
    },
    aspectRatioRange: {
      min: '1:4',
      max: '4:1',
      notes: '1:4 to 4:1',
    },
    modelType: 'image',
  },

  // Fal
  createAspectRatioImageModel('fal', 'fal-ai/flux/dev', 'FLUX Dev'),
  createAspectRatioImageModel('fal', 'fal-ai/flux-lora', 'FLUX LoRA'),
  createAspectRatioImageModel('fal', 'fal-ai/fast-sdxl', 'Fast SDXL'),
  createAspectRatioImageModel('fal', 'fal-ai/flux-pro/v1.1-ultra', 'FLUX Pro 1.1 Ultra'),
  createAspectRatioImageModel('fal', 'fal-ai/ideogram/v2', 'Ideogram V2'),
  createAspectRatioImageModel('fal', 'fal-ai/recraft-v3', 'Recraft V3'),
  createAspectRatioImageModel(
    'fal',
    'fal-ai/stable-diffusion-3.5-large',
    'Stable Diffusion 3.5 Large'
  ),
  createAspectRatioImageModel('fal', 'fal-ai/hyper-sdxl', 'Hyper SDXL'),

  // DeepInfra
  createAspectRatioImageModel(
    'deepinfra',
    'stabilityai/sd3.5',
    'Stable Diffusion 3.5',
    DEEPINFRA_STABILITY_ASPECT_RATIOS
  ),
  createDimensionRangeImageModel(
    'deepinfra',
    'black-forest-labs/FLUX-1.1-pro',
    'FLUX 1.1 Pro',
    DIMENSION_RANGE_256_1440_MULTIPLE_32
  ),
  createDimensionRangeImageModel(
    'deepinfra',
    'black-forest-labs/FLUX-1-schnell',
    'FLUX 1 Schnell',
    DIMENSION_RANGE_256_1440_MULTIPLE_32
  ),
  createDimensionRangeImageModel(
    'deepinfra',
    'black-forest-labs/FLUX-1-dev',
    'FLUX 1 Dev',
    DIMENSION_RANGE_256_1440_MULTIPLE_32
  ),
  createDimensionRangeImageModel(
    'deepinfra',
    'black-forest-labs/FLUX-pro',
    'FLUX Pro',
    DIMENSION_RANGE_256_1440_MULTIPLE_32
  ),
  createAspectRatioImageModel(
    'deepinfra',
    'stabilityai/sd3.5-medium',
    'Stable Diffusion 3.5 Medium',
    DEEPINFRA_STABILITY_ASPECT_RATIOS
  ),
  createAspectRatioImageModel(
    'deepinfra',
    'stabilityai/sdxl-turbo',
    'SDXL Turbo',
    DEEPINFRA_STABILITY_ASPECT_RATIOS
  ),

  // Replicate
  createAspectRatioImageModel(
    'replicate',
    'black-forest-labs/flux-schnell',
    'FLUX Schnell',
    REPLICATE_FLUX_SCHNELL_ASPECT_RATIOS
  ),
  createSizeImageModel('replicate', 'recraft-ai/recraft-v3', 'Recraft V3', REPLICATE_RECRAFT_SIZES),

  // Google (Multimodal LLMs with image generation capability)
  createGeminiImageLanguageModel('gemini-2.5-flash-image', 'Gemini 2.5 Flash Image'),
  createGeminiImageLanguageModel(
    'gemini-2.5-flash-image-preview',
    'Gemini 2.5 Flash Image Preview'
  ),
  createGeminiImageLanguageModel('gemini-3-pro-image', 'Gemini 3 Pro Image'),
  createGeminiImageLanguageModel(
    'gemini-3.1-flash-image-preview',
    'Gemini 3.1 Flash Image Preview'
  ),

  // Google Imagen
  createAspectRatioImageModel(
    'google',
    'imagen-4.0-generate-001',
    'Imagen 4.0',
    GOOGLE_IMAGEN_ASPECT_RATIOS
  ),
  createAspectRatioImageModel(
    'google',
    'imagen-4.0-fast-generate-001',
    'Imagen 4.0 Fast',
    GOOGLE_IMAGEN_ASPECT_RATIOS
  ),
  createAspectRatioImageModel(
    'google',
    'imagen-4.0-ultra-generate-001',
    'Imagen 4.0 Ultra',
    GOOGLE_IMAGEN_ASPECT_RATIOS
  ),

  // ByteDance
  createAspectRatioImageModel('bytedance', 'seedream-4.0', 'Seedream 4.0'),
  createAspectRatioImageModel('bytedance', 'seedream-4.5', 'Seedream 4.5'),
  createAspectRatioImageModel('bytedance', 'seedream-5.0-lite', 'Seedream 5.0 Lite'),

  // Google Vertex
  createAspectRatioImageModel(
    'googleVertex',
    'imagen-4.0-generate-001',
    'Imagen 4.0',
    GOOGLE_IMAGEN_ASPECT_RATIOS
  ),
  createAspectRatioImageModel(
    'googleVertex',
    'imagen-4.0-fast-generate-001',
    'Imagen 4.0 Fast',
    GOOGLE_IMAGEN_ASPECT_RATIOS
  ),
  createAspectRatioImageModel(
    'googleVertex',
    'imagen-4.0-ultra-generate-001',
    'Imagen 4.0 Ultra',
    GOOGLE_IMAGEN_ASPECT_RATIOS
  ),
  createAspectRatioImageModel(
    'googleVertex',
    'imagen-3.0-fast-generate-001',
    'Imagen 3.0 Fast',
    GOOGLE_IMAGEN_ASPECT_RATIOS
  ),

  // Fireworks
  createAspectRatioImageModel(
    'fireworks',
    'accounts/fireworks/models/flux-1-dev-fp8',
    'FLUX 1 Dev FP8',
    FIREWORKS_FLUX_ASPECT_RATIOS
  ),
  createAspectRatioImageModel(
    'fireworks',
    'accounts/fireworks/models/flux-1-schnell-fp8',
    'FLUX 1 Schnell FP8',
    FIREWORKS_FLUX_ASPECT_RATIOS
  ),
  createSizeImageModel(
    'fireworks',
    'accounts/fireworks/models/playground-v2-5-1024px-aesthetic',
    'Playground V2.5 1024px Aesthetic',
    FIREWORKS_1024_SIZES,
    '1024x1024'
  ),
  createSizeImageModel(
    'fireworks',
    'accounts/fireworks/models/japanese-stable-diffusion-xl',
    'Japanese Stable Diffusion XL',
    FIREWORKS_1024_SIZES,
    '1024x1024'
  ),
  createSizeImageModel(
    'fireworks',
    'accounts/fireworks/models/playground-v2-1024px-aesthetic',
    'Playground V2 1024px Aesthetic',
    FIREWORKS_1024_SIZES,
    '1024x1024'
  ),
  createSizeImageModel(
    'fireworks',
    'accounts/fireworks/models/SSD-1B',
    'SSD-1B',
    FIREWORKS_1024_SIZES,
    '1024x1024'
  ),
  createSizeImageModel(
    'fireworks',
    'accounts/fireworks/models/stable-diffusion-xl-1024-v1-0',
    'Stable Diffusion XL 1024 v1.0',
    FIREWORKS_1024_SIZES,
    '1024x1024'
  ),

  // Luma
  createAspectRatioImageModel('luma', 'photon-1', 'Photon 1'),
  createAspectRatioImageModel('luma', 'photon-flash-1', 'Photon Flash 1'),

  // Together.ai
  createSizeImageModel(
    'togetherai',
    'stabilityai/stable-diffusion-xl-base-1.0',
    'Stable Diffusion XL Base 1.0',
    TOGETHERAI_SQUARE_SIZES,
    '1024x1024'
  ),
  createSizeImageModel(
    'togetherai',
    'black-forest-labs/FLUX.1-dev',
    'FLUX.1 Dev',
    TOGETHERAI_SQUARE_SIZES,
    '1024x1024'
  ),
  createSizeImageModel(
    'togetherai',
    'black-forest-labs/FLUX.1-dev-lora',
    'FLUX.1 Dev LoRA',
    TOGETHERAI_SQUARE_SIZES,
    '1024x1024'
  ),
  createSizeImageModel(
    'togetherai',
    'black-forest-labs/FLUX.1-schnell',
    'FLUX.1 Schnell',
    TOGETHERAI_SQUARE_SIZES,
    '1024x1024'
  ),
  createSizeImageModel(
    'togetherai',
    'black-forest-labs/FLUX.1-canny',
    'FLUX.1 Canny',
    TOGETHERAI_SQUARE_SIZES,
    '1024x1024'
  ),
  createSizeImageModel(
    'togetherai',
    'black-forest-labs/FLUX.1-depth',
    'FLUX.1 Depth',
    TOGETHERAI_SQUARE_SIZES,
    '1024x1024'
  ),
  createSizeImageModel(
    'togetherai',
    'black-forest-labs/FLUX.1-redux',
    'FLUX.1 Redux',
    TOGETHERAI_SQUARE_SIZES,
    '1024x1024'
  ),
  createSizeImageModel(
    'togetherai',
    'black-forest-labs/FLUX.1.1-pro',
    'FLUX.1.1 Pro',
    TOGETHERAI_SQUARE_SIZES,
    '1024x1024'
  ),
  createSizeImageModel(
    'togetherai',
    'black-forest-labs/FLUX.1-pro',
    'FLUX.1 Pro',
    TOGETHERAI_SQUARE_SIZES,
    '1024x1024'
  ),
  createSizeImageModel(
    'togetherai',
    'black-forest-labs/FLUX.1-schnell-Free',
    'FLUX.1 Schnell Free',
    TOGETHERAI_SQUARE_SIZES,
    '1024x1024'
  ),

  // Black Forest Labs
  createBflImageModel('flux-2-flex', 'FLUX.2 Flex'),
  createBflImageModel('flux-2-klein-4b', 'FLUX.2 Klein 4B'),
  createBflImageModel('flux-2-klein-9b', 'FLUX.2 Klein 9B'),
  createBflImageModel('flux-2-max', 'FLUX.2 Max'),
  createBflImageModel('flux-2-pro', 'FLUX.2 Pro'),
  createBflImageModel('flux-kontext-pro', 'FLUX Kontext Pro'),
  createBflImageModel('flux-kontext-max', 'FLUX Kontext Max'),
  createBflImageModel('flux-pro-1.1-ultra', 'FLUX Pro 1.1 Ultra'),
  createBflImageModel('flux-pro-1.1', 'FLUX Pro 1.1'),
  createBflImageModel('flux-pro-1.0-fill', 'FLUX Pro 1.0 Fill'),

  // Prodia
  createAspectRatioImageModel(
    'prodia',
    'flux-fast-schnell',
    'Flux Schnell',
    REPLICATE_FLUX_SCHNELL_ASPECT_RATIOS
  ),

  // Recraft
  createRecraftImageModel('recraft-v2', 'Recraft V2'),
  createRecraftImageModel('recraft-v3', 'Recraft V3'),
  createRecraftImageModel('recraft-v4', 'Recraft V4'),
  createRecraftImageModel('recraft-v4-pro', 'Recraft V4 Pro'),
];
