import type { IAttachmentFieldGenerateImageAIConfig } from '@teable/core';
import { ImageQuality } from '@teable/core';
import {
  getImageAspectRatioCandidates,
  getImageModelConfigByModelKey,
  getImageSizeCandidates,
  isPromptControlledImageGenerationModel,
  supportsImageAspectRatioSelection,
  supportsImageCountSelection,
  supportsImageInputForImageModel,
  supportsImageSizeSelection,
} from '@teable/openapi';
import type { IImageModelMetadata, IResolvedImageModelConfig } from '@teable/openapi';
import { useCallback, useMemo } from 'react';

const getModelDefaults = (
  resolvedModel?: IResolvedImageModelConfig
): Partial<IAttachmentFieldGenerateImageAIConfig> => {
  const config = resolvedModel?.config;
  if (!config) return {};

  const isPromptControlledModel = isPromptControlledImageGenerationModel(config);
  const sizeCandidates = getImageSizeCandidates(config);

  return {
    size: supportsImageSizeSelection(config) ? config.defaultSize ?? sizeCandidates[0] : undefined,
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
  const sizeCandidates = getImageSizeCandidates(config);
  const defaultSize = config.defaultSize ?? sizeCandidates[0];

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
  const isPromptControlledModel = imageModelConfig
    ? isPromptControlledImageGenerationModel(imageModelConfig)
    : false;

  const supportsSize = imageModelConfig ? supportsImageSizeSelection(imageModelConfig) : false;
  const supportsQuality = imageModelConfig?.supportsQuality ?? false;
  const supportsCount = imageModelConfig ? supportsImageCountSelection(imageModelConfig) : false;
  const supportsAspectRatio = imageModelConfig
    ? supportsImageAspectRatioSelection(imageModelConfig)
    : false;
  const supportsResolution = isPromptControlledModel;
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
    currentSize:
      aiConfig?.size || imageModelConfig?.defaultSize || imageSizeValues[0] || '1024x1024',
    currentQuality: aiConfig?.quality ?? ImageQuality.Medium,
    currentCount: aiConfig?.n || 1,
    currentAspectRatio: aiConfig?.aspectRatio || imageModelConfig?.defaultAspectRatio,
    currentResolution: aiConfig?.resolution,
    maxCount: imageModelConfig?.maxImagesPerCall || 10,
    maxImagesPerCall: imageModelConfig?.maxImagesPerCall,
    getSettingsUpdates,
  };
};
