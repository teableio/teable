import { z } from 'zod';

/**
 * Full set of image-size literals that Teable's image model catalog can reference.
 *
 * Keep provider/model presets below as subsets of this tuple. Do not add `auto`
 * here: `auto` is a provider behavior, represented by omitting the size option.
 */
export const ALL_IMAGE_SIZES = [
  // Square/common sizes.
  '256x256',
  '512x512',
  '768x768',
  '1024x1024',
  '2048x2048',
  // Landscape sizes.
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
  '2048x1152',
  '3840x2160',
  // Portrait sizes.
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
  '2160x3840',
] as const;

export const imageSizeSchema = z.enum(ALL_IMAGE_SIZES);

export type IImageSize = z.infer<typeof imageSizeSchema>;

/**
 * Full set of aspect-ratio literals accepted by catalog presets and range fallbacks.
 *
 * Keep this list provider-neutral. Provider-specific subsets belong in the preset
 * constants below. `auto` is intentionally excluded for the same reason as sizes.
 */
export const ALL_ASPECT_RATIOS = [
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
  '2:1',
  '1:2',
  '19.5:9',
  '9:19.5',
  '20:9',
  '9:20',
  '1:4',
  '4:1',
  '3:7',
  '7:3',
] as const;

export const aspectRatioSchema = z.enum(ALL_ASPECT_RATIOS);

export type IAspectRatio = z.infer<typeof aspectRatioSchema>;

export interface IImageSizeRange {
  min: number;
  max: number;
  multipleOf?: number;
  maxPixels?: number;
  notes?: string;
}

export interface IImageAspectRatioRange {
  min: IAspectRatio;
  max: IAspectRatio;
  notes?: string;
}

export interface IDefaultImageDimensionConfig {
  defaultSize?: IImageSize;
  defaultAspectRatio?: IAspectRatio;
}

export interface IImageDimensionConstraintConfig {
  supportedSizes?: IImageSize[];
  supportedAspectRatios?: IAspectRatio[];
  sizeRange?: IImageSizeRange;
  aspectRatioRange?: IImageAspectRatioRange;
}

const imageSizePattern = /^\d+x\d+$/;
const aspectRatioPattern = /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/;

/**
 * Conservative fallback sizes shown for generic or unknown size-based image models.
 */
export const DEFAULT_IMAGE_SIZE_CANDIDATES = [
  '256x256',
  '512x512',
  '768x768',
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '1792x1024',
  '1024x1792',
] satisfies IImageSize[];

/**
 * Finite UI candidates used when a provider exposes a numeric size range.
 *
 * The range validator still decides which of these candidates apply to a model.
 */
export const RANGE_IMAGE_SIZE_CANDIDATES = [
  ...DEFAULT_IMAGE_SIZE_CANDIDATES,
  '1024x768',
  '1152x896',
  '1216x832',
  '1280x1024',
  '1344x768',
  '1365x1024',
  '1434x1024',
  '1536x640',
  '1707x1024',
  '1820x1024',
  '2048x1024',
  '768x1344',
  '832x1216',
  '896x1152',
  '640x1536',
  '1024x1280',
  '1024x1344',
  '1024x1365',
  '1024x1434',
  '1024x1707',
  '1024x1820',
  '1024x2048',
] satisfies IImageSize[];

/**
 * Fallback aspect-ratio candidates for range-backed models and generic UI state.
 *
 * This name is kept for compatibility with existing imports; it is not a model
 * default. Specific models should prefer explicit provider presets below.
 */
export const DEFAULT_ASPECT_RATIO_CANDIDATES = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '21:9',
  '9:21',
  '3:2',
  '2:3',
  '2:1',
  '1:2',
  '1:4',
  '4:1',
] satisfies IAspectRatio[];

/**
 * Common aspect-ratio preset used by providers where the catalog does not need
 * a more specific product subset.
 */
export const STANDARD_ASPECT_RATIOS = [
  '1:1',
  '3:4',
  '4:3',
  '9:16',
  '16:9',
  '9:21',
  '21:9',
] satisfies IAspectRatio[];

/**
 * Wider common preset that includes additional portrait/landscape pairs.
 */
export const EXTENDED_ASPECT_RATIOS = [
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
] satisfies IAspectRatio[];

/**
 * OpenAI uses concrete size literals for pure image models. `auto` is handled as
 * a separate provider option when/if the product exposes it.
 */
export const OPENAI_GPT_IMAGE_SIZES = [
  '1024x1024',
  '1536x1024',
  '1024x1536',
] satisfies IImageSize[];
export const OPENAI_GPT_IMAGE_2_SIZES = [
  ...OPENAI_GPT_IMAGE_SIZES,
  '2048x2048',
  '2048x1152',
  '3840x2160',
  '2160x3840',
] satisfies IImageSize[];
export const OPENAI_DALLE3_SIZES = ['1024x1024', '1792x1024', '1024x1792'] satisfies IImageSize[];
export const OPENAI_DALLE2_SIZES = ['256x256', '512x512', '1024x1024'] satisfies IImageSize[];

export const GOOGLE_IMAGEN_ASPECT_RATIOS = [
  '1:1',
  '3:4',
  '4:3',
  '9:16',
  '16:9',
] satisfies IAspectRatio[];

/**
 * Product-facing Gemini subset.
 *
 * The local AI SDK also accepts extreme ratios such as 1:8, 8:1, 1:4, and 4:1
 * for Gemini imageConfig. They are intentionally omitted until the product needs
 * ultra-long images.
 */
export const GEMINI_IMAGE_ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
] satisfies IAspectRatio[];

export const XAI_GROK_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '2:1',
  '1:2',
  '19.5:9',
  '9:19.5',
  '20:9',
  '9:20',
] satisfies IAspectRatio[];

export const DEEPINFRA_STABILITY_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '1:9',
  '3:2',
  '2:3',
  '4:5',
  '5:4',
  '9:16',
  '9:21',
] satisfies IAspectRatio[];

/**
 * Shared FLUX aspect-ratio preset used by providers that expose the same list.
 */
export const FLUX_ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '4:5',
  '5:4',
  '16:9',
  '9:16',
  '9:21',
  '21:9',
] satisfies IAspectRatio[];

export const REPLICATE_FLUX_SCHNELL_ASPECT_RATIOS = FLUX_ASPECT_RATIOS;

export const REPLICATE_RECRAFT_SIZES = [
  '1024x1024',
  '1365x1024',
  '1024x1365',
  '1536x1024',
  '1024x1536',
  '1820x1024',
  '1024x1820',
  '1024x2048',
  '2048x1024',
  '1434x1024',
  '1024x1434',
  '1024x1280',
  '1280x1024',
  '1024x1707',
  '1707x1024',
] satisfies IImageSize[];

export const FIREWORKS_FLUX_ASPECT_RATIOS = FLUX_ASPECT_RATIOS;

export const FIREWORKS_1024_SIZES = [
  '640x1536',
  '768x1344',
  '832x1216',
  '896x1152',
  '1024x1024',
  '1152x896',
  '1216x832',
  '1344x768',
  '1536x640',
] satisfies IImageSize[];

export const TOGETHERAI_SQUARE_SIZES = ['512x512', '768x768', '1024x1024'] satisfies IImageSize[];

/**
 * BFL supports both preset ratios and a continuous ratio range.
 */
export const BFL_ASPECT_RATIO_PRESETS = [
  '3:7',
  '2:3',
  '3:4',
  '1:1',
  '4:3',
  '3:2',
  '7:3',
] satisfies IAspectRatio[];

export const BFL_ASPECT_RATIO_RANGE = {
  min: '3:7',
  max: '7:3',
  notes: 'From 3:7 (portrait) to 7:3 (landscape)',
} satisfies IImageAspectRatioRange;

export const DIMENSION_RANGE_256_1440_MULTIPLE_32 = {
  min: 256,
  max: 1440,
  multipleOf: 32,
} satisfies IImageSizeRange;

export function isImageSizeSupported(
  config: IImageDimensionConstraintConfig,
  size?: string
): size is `${number}x${number}` {
  if (!size || !imageSizePattern.test(size)) return false;

  if (config.supportedSizes?.includes(size as IImageSize)) {
    return true;
  }

  if (!config.sizeRange) return false;

  const [width, height] = size.split('x').map(Number);
  const { min, max, multipleOf, maxPixels } = config.sizeRange;

  if (!width || !height || width < min || height < min || width > max || height > max) {
    return false;
  }
  if (multipleOf && (width % multipleOf !== 0 || height % multipleOf !== 0)) {
    return false;
  }
  if (maxPixels && width * height > maxPixels) {
    return false;
  }

  return true;
}

const aspectRatioToNumber = (aspectRatio: string): number | undefined => {
  const [width, height] = aspectRatio.split(':').map(Number);
  if (!width || !height) return undefined;
  return width / height;
};

export function isAspectRatioSupported(
  config: IImageDimensionConstraintConfig,
  aspectRatio?: string
): aspectRatio is `${number}:${number}` {
  if (!aspectRatio || !aspectRatioPattern.test(aspectRatio)) return false;

  if (config.supportedAspectRatios?.includes(aspectRatio as IAspectRatio)) {
    return true;
  }

  if (!config.aspectRatioRange) return false;

  const ratio = aspectRatioToNumber(aspectRatio);
  const minRatio = aspectRatioToNumber(config.aspectRatioRange.min);
  const maxRatio = aspectRatioToNumber(config.aspectRatioRange.max);
  if (!ratio || !minRatio || !maxRatio) return false;

  return ratio >= minRatio && ratio <= maxRatio;
}

export function getImageSizeCandidates(config: IImageDimensionConstraintConfig): IImageSize[] {
  if (config.supportedSizes?.length) return config.supportedSizes;
  if (!config.sizeRange) return [];
  return RANGE_IMAGE_SIZE_CANDIDATES.filter((size) => isImageSizeSupported(config, size));
}

export function getImageAspectRatioCandidates(
  config: IImageDimensionConstraintConfig
): IAspectRatio[] {
  if (config.supportedAspectRatios?.length) return config.supportedAspectRatios;
  if (!config.aspectRatioRange) return [];
  return DEFAULT_ASPECT_RATIO_CANDIDATES.filter((aspectRatio) =>
    isAspectRatioSupported(config, aspectRatio)
  );
}

/**
 * Get default size or aspect ratio for a model-like dimension config.
 */
export function getDefaultImageDimension(config: IDefaultImageDimensionConfig): {
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
 * Convert aspect ratio to approximate size.
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
