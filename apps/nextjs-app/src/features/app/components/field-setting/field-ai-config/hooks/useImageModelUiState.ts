import type { IAttachmentFieldGenerateImageAIConfig } from '@teable/core';
import { ImageQuality } from '@teable/core';
import {
  getImageAspectRatioCandidates,
  getImageModelConfigByModelKey,
  getImageQualityCandidates,
  getImageResolutionCandidates,
  getImageSizeCandidates,
  getSupportedImageResolution,
  isPromptControlledImageGenerationModel,
  supportsImageAspectRatioSelection,
  supportsImageCountSelection,
  supportsImageInputForImageModel,
  supportsImageSizeSelection,
} from '@teable/openapi';
import type { IImageModelMetadata, IResolvedImageModelConfig } from '@teable/openapi';
import { useCallback, useMemo } from 'react';

const AUTO_SIZE_ID = '';

const getModelDefaults = (
  resolvedModel?: IResolvedImageModelConfig
): Partial<IAttachmentFieldGenerateImageAIConfig> => {
  const config = resolvedModel?.config;
  if (!config) return {};

  const isPromptControlledModel = isPromptControlledImageGenerationModel(config);

  return {
    size: supportsImageSizeSelection(config) ? config.defaultSize : undefined,
    resolution: undefined,
    quality: config.supportsQuality ? ImageQuality.Medium : undefined,
    n: supportsImageCountSelection(config) ? 1 : undefined,
    aspectRatio:
      supportsImageAspectRatioSelection(config) && !isPromptControlledModel
        ? config.defaultAspectRatio
        : undefined,
  };
};

const getInitialLoadUpdates = (
  resolvedModel?: IResolvedImageModelConfig,
  currentConfig?: IAttachmentFieldGenerateImageAIConfig
): Partial<IAttachmentFieldGenerateImageAIConfig> => {
  const config = resolvedModel?.config;
  if (!config) return {};

  const updates: Partial<IAttachmentFieldGenerateImageAIConfig> = {};
  const isPromptControlledModel = isPromptControlledImageGenerationModel(config);
  const defaultSize = config.defaultSize;

  if (
    currentConfig?.resolution !== getSupportedImageResolution(config, currentConfig?.resolution)
  ) {
    updates.resolution = undefined;
  }
  if (
    currentConfig?.quality &&
    !getImageQualityCandidates(config).includes(currentConfig.quality)
  ) {
    updates.quality = config.supportsQuality ? ImageQuality.Medium : undefined;
  }

  if (supportsImageSizeSelection(config) && !currentConfig?.size && defaultSize) {
    updates.size = defaultSize;
  }
  if (config.supportsQuality && currentConfig?.quality === undefined) {
    updates.quality = ImageQuality.Medium;
  }
  if (supportsImageCountSelection(config) && !currentConfig?.n) {
    updates.n = 1;
  }
  if (
    supportsImageAspectRatioSelection(config) &&
    !isPromptControlledModel &&
    !currentConfig?.aspectRatio &&
    config.defaultAspectRatio
  ) {
    updates.aspectRatio = config.defaultAspectRatio;
  }

  return updates;
};

export const useImageModelUiState = (
  modelKey?: string,
  gatewayModels: readonly IImageModelMetadata[] = [],
  aiConfig?: IAttachmentFieldGenerateImageAIConfig
) => {
  const resolvedImageModel = useMemo(
    () => getImageModelConfigByModelKey(modelKey, gatewayModels),
    [modelKey, gatewayModels]
  );
  const imageModelConfig = resolvedImageModel?.config;
  const supportsSize = imageModelConfig ? supportsImageSizeSelection(imageModelConfig) : false;
  const supportsQuality = imageModelConfig?.supportsQuality ?? false;
  const supportsCount = imageModelConfig ? supportsImageCountSelection(imageModelConfig) : false;
  const supportsAspectRatio = imageModelConfig
    ? supportsImageAspectRatioSelection(imageModelConfig)
    : false;
  const resolutionValues = imageModelConfig ? getImageResolutionCandidates(imageModelConfig) : [];
  const qualityValues = imageModelConfig ? getImageQualityCandidates(imageModelConfig) : [];
  const supportsResolution = resolutionValues.length > 0;
  const supportsImageInput = resolvedImageModel
    ? supportsImageInputForImageModel(
        resolvedImageModel.config,
        resolvedImageModel.modelId,
        resolvedImageModel.tags
      )
    : false;
  const hasAdvancedOptions =
    supportsSize || supportsQuality || supportsCount || supportsAspectRatio || supportsResolution;

  const imageSizeValues = useMemo(
    () => (imageModelConfig ? getImageSizeCandidates(imageModelConfig) : []),
    [imageModelConfig]
  );
  const aspectRatioValues = useMemo(
    () => (imageModelConfig ? getImageAspectRatioCandidates(imageModelConfig) : []),
    [imageModelConfig]
  );

  const getSettingsUpdates = useCallback(
    (isModelChanged: boolean, currentConfig?: IAttachmentFieldGenerateImageAIConfig) => {
      return isModelChanged
        ? getModelDefaults(resolvedImageModel)
        : getInitialLoadUpdates(resolvedImageModel, currentConfig);
    },
    [resolvedImageModel]
  );

  return {
    imageModelConfig,
    supportsSize,
    supportsQuality,
    supportsCount,
    supportsAspectRatio,
    supportsResolution,
    supportsImageInput,
    hasAdvancedOptions,
    imageSizeValues,
    aspectRatioValues,
    resolutionValues,
    qualityValues,
    currentSize: aiConfig?.size || imageModelConfig?.defaultSize || AUTO_SIZE_ID,
    currentQuality:
      aiConfig?.quality && qualityValues.includes(aiConfig.quality)
        ? aiConfig.quality
        : ImageQuality.Medium,
    currentCount: aiConfig?.n || 1,
    currentAspectRatio: aiConfig?.aspectRatio || imageModelConfig?.defaultAspectRatio,
    currentResolution: getSupportedImageResolution(imageModelConfig, aiConfig?.resolution),
    maxCount: imageModelConfig?.maxImagesPerCall || 10,
    maxImagesPerCall: imageModelConfig?.maxImagesPerCall,
    imageModelId: imageModelConfig?.model,
    getSettingsUpdates,
  };
};
