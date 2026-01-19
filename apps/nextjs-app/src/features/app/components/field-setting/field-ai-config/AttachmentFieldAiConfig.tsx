import { useQuery } from '@tanstack/react-query';
import type {
  IAttachmentFieldAIConfig,
  IAttachmentFieldCustomizeAIConfig,
  IAttachmentFieldGenerateImageAIConfig,
  IImageResolution,
} from '@teable/core';
import { FieldAIActionType, FieldType, ImageQuality } from '@teable/core';
import { ChevronDown, ChevronRight, ImageGeneration, Pencil, Settings } from '@teable/icons';
import {
  getAIConfig,
  LLMProviderType,
  getImageModelConfigByGatewayId,
  type IImageModelConfig,
} from '@teable/openapi';
import { useBaseId } from '@teable/sdk/hooks';
import { Selector } from '@teable/ui-lib/base';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Slider,
  Textarea,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AIModelSelect } from '@/features/app/blocks/admin/setting/components/ai-config/AiModelSelect';
import {
  generateModelKeyList,
  generateGatewayModelKeyList,
  parseModelKey,
} from '@/features/app/blocks/admin/setting/components/ai-config/utils';
import { RequireCom } from '@/features/app/blocks/setting/components/RequireCom';
import { tableConfig } from '@/features/i18n/table.config';
import type { IFieldEditorRo } from '../type';
import { FieldSelect, PromptEditorContainer } from './components';

// Extended model capabilities for UI rendering
interface IModelCapabilities {
  supportsSize: boolean;
  supportsQuality: boolean;
  supportsCount: boolean;
  supportsImageInput: boolean;
  supportsSeed: boolean;
  supportsStyle: boolean;
  /** Supports aspect ratio selection (for multimodal LLMs that use prompt-based control) */
  supportsAspectRatio?: boolean;
  /** Supports resolution selection (for multimodal LLMs that use prompt-based control) */
  supportsResolution?: boolean;
  supportedSizes?: string[];
  supportedAspectRatios?: string[];
  /** Supported resolution presets (1K, 2K, 4K) */
  supportedResolutions?: IImageResolution[];
  defaultSize?: string;
  defaultAspectRatio?: string;
  /** Default resolution preset */
  defaultResolution?: IImageResolution;
  maxImagesPerCall?: number;
  sizeType?: 'size' | 'aspectRatio' | 'both' | 'flexible';
}

const DEFAULT_CAPABILITIES: IModelCapabilities = {
  supportsSize: true,
  supportsQuality: true,
  supportsCount: true,
  supportsImageInput: false,
  supportsSeed: false,
  supportsStyle: false,
  defaultSize: '1024x1024',
};

const MULTIMODAL_LLM_CAPABILITIES: IModelCapabilities = {
  supportsSize: false,
  supportsQuality: false,
  supportsCount: true,
  supportsImageInput: true,
  supportsSeed: false,
  supportsStyle: false,
  sizeType: 'flexible',
  // Multimodal LLMs support aspect ratio via prompt instructions (no default - let model decide)
  supportsAspectRatio: true,
  supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '3:2', '2:3'],
  // Multimodal LLMs support resolution via prompt instructions (no default - let model decide)
  supportsResolution: true,
  supportedResolutions: ['1K', '2K', '4K'],
};

/**
 * Get capabilities for legacy (non-gateway) models based on model name
 */
const getLegacyModelCapabilities = (modelLower: string): IModelCapabilities | null => {
  if (modelLower.includes('gemini')) return MULTIMODAL_LLM_CAPABILITIES;
  if (modelLower.includes('gpt-image-1')) {
    return {
      ...DEFAULT_CAPABILITIES,
      supportsStyle: true,
      supportedSizes: ['1024x1024', '1536x1024', '1024x1536'],
    };
  }
  if (modelLower.includes('dall-e-3')) {
    return {
      ...DEFAULT_CAPABILITIES,
      supportsCount: false,
      supportsSeed: true,
      supportsStyle: true,
      supportedSizes: ['1024x1024', '1792x1024', '1024x1792'],
      maxImagesPerCall: 1,
    };
  }
  if (modelLower.includes('dall-e-2')) {
    return {
      ...DEFAULT_CAPABILITIES,
      supportsQuality: false,
      supportedSizes: ['256x256', '512x512', '1024x1024'],
    };
  }
  if (modelLower.includes('grok')) {
    return { ...DEFAULT_CAPABILITIES, supportsSize: false, supportsQuality: false };
  }
  return null;
};

/**
 * Get model capabilities from the new unified config or fallback to legacy detection
 */
const getModelCapabilities = (
  modelKey?: string,
  gatewayModels?: Array<{ id: string; type?: string; tags?: string[] }>
): IModelCapabilities => {
  if (!modelKey) return DEFAULT_CAPABILITIES;

  const { type, model } = parseModelKey(modelKey);
  const modelLower = model?.toLowerCase() ?? '';

  // For AI Gateway models, try to get config from unified config
  if (type === LLMProviderType.AI_GATEWAY && model) {
    const imageConfig = getImageModelConfigByGatewayId(model);
    if (imageConfig) return mapImageConfigToCapabilities(imageConfig);

    // Fall back to gateway model metadata
    const gatewayModel = gatewayModels?.find((m) => m.id === model);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gatewayModelType = (gatewayModel as any)?.modelType || (gatewayModel as any)?.type;
    const tags = gatewayModel?.tags ?? [];

    if (gatewayModelType === 'language' && tags.includes('image-generation')) {
      return MULTIMODAL_LLM_CAPABILITIES;
    }
    if (gatewayModelType === 'image') {
      return DEFAULT_CAPABILITIES;
    }
  }

  // Legacy detection for non-gateway models
  if (type === LLMProviderType.GOOGLE) return MULTIMODAL_LLM_CAPABILITIES;
  return getLegacyModelCapabilities(modelLower) ?? DEFAULT_CAPABILITIES;
};

/**
 * Map IImageModelConfig to IModelCapabilities
 */
const mapImageConfigToCapabilities = (config: IImageModelConfig): IModelCapabilities => {
  // Multimodal LLMs (language models with image-generation tag) support aspect ratio via prompt
  const isMultimodalLLM =
    config.modelType === 'language' && (config.tags?.includes('image-generation') ?? false);

  return {
    supportsSize: config.sizeType === 'size' || config.sizeType === 'both',
    supportsQuality: config.supportsQuality ?? false,
    supportsCount: config.maxImagesPerCall !== 1,
    supportsImageInput: isMultimodalLLM,
    supportsSeed: config.supportsSeed ?? false,
    supportsStyle: config.supportsStyle ?? false,
    // Multimodal LLMs support aspect ratio via prompt instructions (no default - let model decide)
    supportsAspectRatio: isMultimodalLLM || config.sizeType === 'aspectRatio',
    // Multimodal LLMs support resolution via prompt instructions (no default - let model decide)
    supportsResolution: isMultimodalLLM,
    supportedResolutions: isMultimodalLLM ? ['1K', '2K', '4K'] : undefined,
    // For multimodal LLMs, don't set defaults - only use values if explicitly specified
    supportedSizes: config.supportedSizes,
    supportedAspectRatios: config.supportedAspectRatios,
    defaultSize: isMultimodalLLM ? undefined : config.defaultSize,
    defaultAspectRatio: isMultimodalLLM ? undefined : config.defaultAspectRatio,
    maxImagesPerCall: config.maxImagesPerCall,
    sizeType: config.sizeType,
  };
};

/**
 * Get default settings based on model capabilities
 * For multimodal LLMs (Gemini, etc.), don't set defaults for prompt-based controls - let the model decide
 */
const getModelDefaults = (
  capabilities: IModelCapabilities
): Partial<IAttachmentFieldGenerateImageAIConfig> => ({
  size: capabilities.supportsSize ? capabilities.defaultSize || '1024x1024' : undefined,
  quality: capabilities.supportsQuality ? ImageQuality.Medium : undefined,
  n: capabilities.supportsCount ? 1 : undefined,
  // Only set aspectRatio/resolution if there's an explicit default (not for multimodal LLMs)
  aspectRatio: capabilities.supportsAspectRatio ? capabilities.defaultAspectRatio : undefined,
  resolution: capabilities.supportsResolution ? capabilities.defaultResolution : undefined,
});

/**
 * Calculate settings updates for initial load (only fill missing values)
 * For multimodal LLMs, don't auto-fill prompt-based controls (aspectRatio, resolution)
 */
const getInitialLoadUpdates = (
  capabilities: IModelCapabilities,
  currentConfig?: IAttachmentFieldGenerateImageAIConfig
): Partial<IAttachmentFieldGenerateImageAIConfig> => {
  const updates: Partial<IAttachmentFieldGenerateImageAIConfig> = {};

  if (capabilities.supportsSize && !currentConfig?.size && capabilities.defaultSize) {
    updates.size = capabilities.defaultSize;
  }
  if (capabilities.supportsQuality && currentConfig?.quality === undefined) {
    updates.quality = ImageQuality.Medium;
  }
  if (capabilities.supportsCount && !currentConfig?.n) {
    updates.n = 1;
  }
  // Only auto-fill aspectRatio/resolution if there's an explicit default (not for multimodal LLMs)
  if (
    capabilities.supportsAspectRatio &&
    !currentConfig?.aspectRatio &&
    capabilities.defaultAspectRatio
  ) {
    updates.aspectRatio = capabilities.defaultAspectRatio;
  }
  if (
    capabilities.supportsResolution &&
    !currentConfig?.resolution &&
    capabilities.defaultResolution
  ) {
    updates.resolution = capabilities.defaultResolution;
  }

  return updates;
};

interface IAttachmentFieldAiConfigProps {
  field: Partial<IFieldEditorRo>;
  onChange?: (partialField: Partial<IFieldEditorRo>) => void;
}

export const AttachmentFieldAiConfig = (props: IAttachmentFieldAiConfigProps) => {
  const { field, onChange } = props;
  const { id, aiConfig } = field;
  const { type } = aiConfig ?? {};
  const modelKey = (aiConfig as IAttachmentFieldGenerateImageAIConfig)?.modelKey;
  const baseId = useBaseId() as string;
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Track previous model key to detect model changes
  const prevModelKeyRef = useRef<string | undefined>(modelKey);

  // Use refs to access latest values in useEffect without adding them to dependencies
  const aiConfigRef = useRef(aiConfig);
  const onChangeRef = useRef(onChange);
  aiConfigRef.current = aiConfig;
  onChangeRef.current = onChange;

  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const { data: baseAiConfig } = useQuery({
    queryKey: ['ai-config', baseId],
    queryFn: () => getAIConfig(baseId).then(({ data }) => data),
  });

  const { llmProviders = [], modelDefinationMap, gatewayModels } = baseAiConfig ?? {};
  const models = [
    ...generateGatewayModelKeyList(gatewayModels),
    ...generateModelKeyList(llmProviders),
  ];

  // Get model capabilities based on the selected model
  const modelCapabilities = useMemo(
    () => getModelCapabilities(modelKey, gatewayModels),
    [modelKey, gatewayModels]
  );

  // Check if there are any advanced options to show
  const hasAdvancedOptions = useMemo(() => {
    return (
      modelCapabilities.supportsSize ||
      modelCapabilities.supportsQuality ||
      modelCapabilities.supportsCount ||
      modelCapabilities.supportsAspectRatio ||
      modelCapabilities.supportsResolution
    );
  }, [modelCapabilities]);

  const candidates = useMemo(() => {
    return [
      {
        id: FieldAIActionType.ImageGeneration,
        icon: <ImageGeneration className="size-4" />,
        name: t('table:field.aiConfig.type.imageGeneration'),
      },
      {
        id: FieldAIActionType.ImageCustomization,
        icon: <Pencil className="size-4" />,
        name: t('table:field.aiConfig.type.customization'),
      },
    ];
  }, [t]);

  const onConfigChange = useCallback(
    (
      key:
        | keyof IAttachmentFieldGenerateImageAIConfig
        | keyof IAttachmentFieldCustomizeAIConfig
        | 'modelKey',
      value: unknown
    ) => {
      switch (key) {
        case 'type':
          return onChange?.({ aiConfig: { type: value } as IAttachmentFieldAIConfig });
        case 'modelKey':
          return onChange?.({
            aiConfig: { ...aiConfig, modelKey: value as string } as IAttachmentFieldAIConfig,
          });
        case 'sourceFieldId':
          return onChange?.({
            aiConfig: { ...aiConfig, sourceFieldId: value as string } as IAttachmentFieldAIConfig,
          });
        case 'size':
          return onChange?.({
            aiConfig: { ...aiConfig, size: value as string } as IAttachmentFieldAIConfig,
          });
        case 'attachPrompt':
          return onChange?.({
            aiConfig: {
              ...aiConfig,
              attachPrompt: value as string,
            } as IAttachmentFieldGenerateImageAIConfig,
          });
        case 'n':
          return onChange?.({
            aiConfig: { ...aiConfig, n: value as number } as IAttachmentFieldGenerateImageAIConfig,
          });
        case 'quality':
          return onChange?.({
            aiConfig: {
              ...aiConfig,
              quality: value as ImageQuality,
            } as IAttachmentFieldGenerateImageAIConfig,
          });
        case 'aspectRatio':
          return onChange?.({
            aiConfig: {
              ...aiConfig,
              aspectRatio: value as string,
            } as IAttachmentFieldGenerateImageAIConfig,
          });
        case 'resolution':
          return onChange?.({
            aiConfig: {
              ...aiConfig,
              resolution: value as IImageResolution,
            } as IAttachmentFieldGenerateImageAIConfig,
          });
        case 'prompt':
          return onChange?.({
            aiConfig: { ...aiConfig, prompt: value as string } as IAttachmentFieldCustomizeAIConfig,
          });
        default:
          throw new Error(`Unsupported key: ${key}`);
      }
    },
    [aiConfig, onChange]
  );

  // Reset advanced settings to new model's defaults when model changes
  useEffect(() => {
    if (!modelKey || type !== FieldAIActionType.ImageGeneration) {
      prevModelKeyRef.current = modelKey;
      return;
    }

    const isModelChanged = prevModelKeyRef.current !== modelKey;
    prevModelKeyRef.current = modelKey;

    // Use refs to get latest values to avoid stale closure issues
    const currentAiConfig = aiConfigRef.current;
    const currentOnChange = onChangeRef.current;

    // When model changes: reset ALL settings to new model's defaults
    // On initial load: only fill in missing values
    const updates = isModelChanged
      ? getModelDefaults(modelCapabilities)
      : getInitialLoadUpdates(
          modelCapabilities,
          currentAiConfig as IAttachmentFieldGenerateImageAIConfig
        );

    if (Object.keys(updates).length > 0) {
      currentOnChange?.({
        aiConfig: { ...currentAiConfig, ...updates } as IAttachmentFieldAIConfig,
      });
    }
  }, [modelKey, type, modelCapabilities]);

  const imageSizeCandidates = useMemo(() => {
    // Use model-specific sizes if available
    if (modelCapabilities.supportedSizes?.length) {
      return modelCapabilities.supportedSizes.map((size) => ({ id: size, name: size }));
    }

    // Default sizes
    return [
      { id: '256x256', name: '256x256' },
      { id: '512x512', name: '512x512' },
      { id: '1024x1024', name: '1024x1024' },
      { id: '1536x1024', name: '1536x1024' },
      { id: '1024x1536', name: '1024x1536' },
      { id: '1792x1024', name: '1792x1024' },
      { id: '1024x1792', name: '1024x1792' },
    ];
  }, [modelCapabilities.supportedSizes]);

  const qualityCandidates = useMemo(
    () => [
      { id: ImageQuality.Low, name: t('table:field.aiConfig.imageQuality.low') },
      { id: ImageQuality.Medium, name: t('table:field.aiConfig.imageQuality.medium') },
      { id: ImageQuality.High, name: t('table:field.aiConfig.imageQuality.high') },
    ],
    [t]
  );

  const aspectRatioCandidates = useMemo(() => {
    const autoOption = { id: '', name: t('table:field.aiConfig.auto') };
    // Use model-specific aspect ratios if available
    if (modelCapabilities.supportedAspectRatios?.length) {
      return [
        autoOption,
        ...modelCapabilities.supportedAspectRatios.map((ratio) => ({
          id: ratio,
          name: ratio,
        })),
      ];
    }
    // Default aspect ratios for multimodal LLMs
    return [
      autoOption,
      { id: '1:1', name: '1:1' },
      { id: '16:9', name: '16:9' },
      { id: '9:16', name: '9:16' },
      { id: '4:3', name: '4:3' },
      { id: '3:4', name: '3:4' },
      { id: '21:9', name: '21:9' },
      { id: '3:2', name: '3:2' },
      { id: '2:3', name: '2:3' },
    ];
  }, [modelCapabilities.supportedAspectRatios, t]);

  const resolutionCandidates = useMemo(
    () => [
      { id: '', name: t('table:field.aiConfig.auto') },
      { id: '1K', name: t('table:field.aiConfig.resolution.1K') },
      { id: '2K', name: t('table:field.aiConfig.resolution.2K') },
      { id: '4K', name: t('table:field.aiConfig.resolution.4K') },
    ],
    [t]
  );

  // Get current values with defaults
  const currentSize =
    (aiConfig as IAttachmentFieldGenerateImageAIConfig)?.size ||
    modelCapabilities.defaultSize ||
    '1024x1024';
  const currentQuality =
    (aiConfig as IAttachmentFieldGenerateImageAIConfig)?.quality ?? ImageQuality.Medium;
  const currentCount = (aiConfig as IAttachmentFieldGenerateImageAIConfig)?.n || 1;
  const maxCount = modelCapabilities.maxImagesPerCall || 10;
  // For multimodal LLMs, aspectRatio/resolution can be undefined (let model decide)
  const currentAspectRatio =
    (aiConfig as IAttachmentFieldGenerateImageAIConfig)?.aspectRatio ||
    modelCapabilities.defaultAspectRatio;
  const currentResolution =
    (aiConfig as IAttachmentFieldGenerateImageAIConfig)?.resolution ||
    modelCapabilities.defaultResolution;

  return (
    <Fragment>
      <div className="flex flex-col gap-y-2">
        <span>{t('table:field.aiConfig.label.type')}</span>
        <Selector
          className="w-full"
          placeholder={t('table:field.aiConfig.placeholder.type')}
          selectedId={type}
          onChange={(id) => {
            onConfigChange('type', id);
          }}
          candidates={candidates}
          searchTip={t('sdk:common.search.placeholder')}
          emptyTip={t('sdk:common.search.empty')}
        />
      </div>

      {Boolean(type) && (
        <Fragment>
          {/* AI Model - placed second, right after action type */}
          <div className="flex flex-col gap-y-2">
            <span>
              {t('table:field.aiConfig.label.model')}
              <RequireCom />
            </span>
            <AIModelSelect
              value={modelKey || ''}
              onValueChange={(newValue) => {
                onConfigChange('modelKey', newValue);
              }}
              options={models}
              className="w-full px-2"
              modelDefinationMap={modelDefinationMap}
              needGroup
              onlyImageOutput
            />
          </div>

          {type === FieldAIActionType.ImageCustomization ? (
            <div className="flex flex-col gap-y-2">
              <PromptEditorContainer
                excludedFieldId={id}
                value={(aiConfig as IAttachmentFieldCustomizeAIConfig)?.prompt || ''}
                onChange={(value) => onConfigChange('prompt', value)}
                label={t('table:field.aiConfig.label.prompt')}
                placeholder={t('table:field.aiConfig.placeholder.prompt')}
                required={true}
                isOptionDisabled={(field) =>
                  !modelCapabilities.supportsImageInput && field.type === FieldType.Attachment
                }
                getDisabledReason={(field) =>
                  !modelCapabilities.supportsImageInput && field.type === FieldType.Attachment
                    ? t('table:field.aiConfig.hint.attachmentNotSupported')
                    : undefined
                }
              />
            </div>
          ) : (
            <Fragment>
              {/* Source Field */}
              <div className="flex flex-col gap-y-2">
                <span>
                  {t('table:field.aiConfig.label.sourceFieldForAttachment')}
                  <RequireCom />
                </span>
                <FieldSelect
                  excludedIds={id ? [id] : []}
                  disabledTypes={modelCapabilities.supportsImageInput ? [] : [FieldType.Attachment]}
                  disabledReason={t('table:field.aiConfig.hint.attachmentNotSupported')}
                  selectedId={(aiConfig as IAttachmentFieldGenerateImageAIConfig)?.sourceFieldId}
                  onChange={(fieldId) => onConfigChange('sourceFieldId', fieldId)}
                />
                {modelCapabilities.supportsImageInput && (
                  <p className="text-xs text-muted-foreground">
                    {t('table:field.aiConfig.hint.imageInputSupported')}
                  </p>
                )}
              </div>

              {/* Additional Prompt (always visible) */}
              <div className="flex flex-col gap-y-2">
                <span>{t('table:field.aiConfig.label.attachPrompt')}</span>
                <Textarea
                  placeholder={t('table:field.aiConfig.placeholder.attachPromptForImageGeneration')}
                  className="w-full"
                  value={(aiConfig as IAttachmentFieldGenerateImageAIConfig)?.attachPrompt || ''}
                  onChange={(e) => {
                    onConfigChange('attachPrompt', e.target.value);
                  }}
                />
              </div>
            </Fragment>
          )}

          {/* Advanced Settings - Collapsible (shared by both modes) */}
          {hasAdvancedOptions && (
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
                <Settings className="size-4" />
                <span className="flex-1 text-left">
                  {t('table:field.aiConfig.label.advancedSettings')}
                </span>
                {advancedOpen ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-4 rounded-md border p-3">
                {/* Image size */}
                {modelCapabilities.supportsSize && (
                  <div className="flex flex-col gap-y-2">
                    <span className="text-sm">{t('table:field.aiConfig.label.imageSize')}</span>
                    <Selector
                      className="w-full"
                      placeholder={t('table:field.aiConfig.placeholder.imageSize')}
                      selectedId={currentSize}
                      onChange={(id) => onConfigChange('size', id)}
                      candidates={imageSizeCandidates}
                      searchTip={t('sdk:common.search.placeholder')}
                      emptyTip={t('sdk:common.search.empty')}
                    />
                  </div>
                )}

                {/* Image quality */}
                {modelCapabilities.supportsQuality && (
                  <div className="flex flex-col gap-y-2">
                    <span className="text-sm">{t('table:field.aiConfig.label.imageQuality')}</span>
                    <Selector
                      className="w-full"
                      placeholder={t('table:field.aiConfig.placeholder.imageQuality')}
                      selectedId={currentQuality}
                      onChange={(id) => onConfigChange('quality', id)}
                      candidates={qualityCandidates}
                      searchTip={t('sdk:common.search.placeholder')}
                      emptyTip={t('sdk:common.search.empty')}
                    />
                  </div>
                )}

                {/* Aspect ratio (for multimodal LLMs like Gemini) */}
                {modelCapabilities.supportsAspectRatio && (
                  <div className="flex flex-col gap-y-2">
                    <span className="text-sm">{t('table:field.aiConfig.label.aspectRatio')}</span>
                    <Selector
                      className="w-full"
                      placeholder={t('table:field.aiConfig.placeholder.aspectRatio')}
                      selectedId={currentAspectRatio ?? ''}
                      onChange={(id) => onConfigChange('aspectRatio', id || undefined)}
                      candidates={aspectRatioCandidates}
                      searchTip={t('sdk:common.search.placeholder')}
                      emptyTip={t('sdk:common.search.empty')}
                    />
                  </div>
                )}

                {/* Resolution (for multimodal LLMs like Gemini) */}
                {modelCapabilities.supportsResolution && (
                  <div className="flex flex-col gap-y-2">
                    <span className="text-sm">{t('table:field.aiConfig.label.resolution')}</span>
                    <Selector
                      className="w-full"
                      placeholder={t('table:field.aiConfig.placeholder.resolution')}
                      selectedId={currentResolution ?? ''}
                      onChange={(id) => onConfigChange('resolution', id || undefined)}
                      candidates={resolutionCandidates}
                      searchTip={t('sdk:common.search.placeholder')}
                      emptyTip={t('sdk:common.search.empty')}
                    />
                  </div>
                )}

                {/* Image count */}
                {modelCapabilities.supportsCount && (
                  <div className="flex flex-col gap-y-2">
                    <span className="text-sm">{t('table:field.aiConfig.label.imageCount')}</span>
                    <div className="flex w-full cursor-pointer justify-between gap-x-4 rounded-md border px-3 py-2">
                      <Slider
                        value={[currentCount]}
                        min={1}
                        max={maxCount}
                        step={1}
                        className="grow"
                        onValueChange={(value) => onConfigChange('n', Number(value[0]))}
                      />
                      <span className="min-w-[24px] text-center">{currentCount}</span>
                    </div>
                    {modelCapabilities.maxImagesPerCall === 1 && (
                      <p className="text-xs text-muted-foreground">
                        {t('table:field.aiConfig.hint.singleImageOnly')}
                      </p>
                    )}
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </Fragment>
      )}
    </Fragment>
  );
};
