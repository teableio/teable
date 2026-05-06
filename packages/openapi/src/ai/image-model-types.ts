import type {
  IAspectRatio,
  IImageAspectRatioRange,
  IImageSize,
  IImageSizeRange,
} from './image-model-dimensions';

/**
 * Image model configuration interface.
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
  /** Whether the provider supports automatic aspect ratio selection */
  supportsAutoAspectRatio?: boolean;
  /** Supported size range for models that accept arbitrary dimensions */
  sizeRange?: IImageSizeRange;
  /** Supported aspect ratio range for models that accept arbitrary ratios */
  aspectRatioRange?: IImageAspectRatioRange;
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
