import { useQuery } from '@tanstack/react-query';
import type {
  IAttachmentFieldAIConfig,
  IAttachmentFieldCustomizeAIConfig,
  IAttachmentFieldGenerateImageAIConfig,
} from '@teable/core';
import { FieldAIActionType, FieldType } from '@teable/core';
import { ImageGeneration, Pencil } from '@teable/icons';
import {
  getAIConfig,
  getImageModelConfigByModelKey,
  isPromptControlledImageGenerationModel,
  supportsImageAspectRatioSelection,
  supportsImageSizeSelection,
} from '@teable/openapi';
import type { IImageModelConfig } from '@teable/openapi';
import { useBaseId } from '@teable/sdk/hooks';
import { Selector } from '@teable/ui-lib/base';
import { Textarea } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AIModelSelect } from '@/features/app/blocks/admin/setting/components/ai-config/AiModelSelect';
import {
  generateModelKeyList,
  generateGatewayModelKeyList,
} from '@/features/app/blocks/admin/setting/components/ai-config/utils';
import { RequireCom } from '@/features/app/blocks/setting/components/RequireCom';
import { tableConfig } from '@/features/i18n/table.config';
import type { IFieldEditorRo } from '../type';
import { AdvancedImageSettings, FieldSelect, PromptEditorContainer } from './components';
import { useImageModelUiState } from './hooks';

interface IAttachmentFieldAiConfigProps {
  field: Partial<IFieldEditorRo>;
  onChange?: (partialField: Partial<IFieldEditorRo>) => void;
}

type IAttachmentAiConfigPatch = Partial<
  Omit<IAttachmentFieldGenerateImageAIConfig, 'type'> &
    Omit<IAttachmentFieldCustomizeAIConfig, 'type'>
>;

export const sanitizeAttachmentAiConfigForModel = (
  baseConfig: Record<string, unknown>,
  patch: IAttachmentAiConfigPatch,
  nextModelConfig?: IImageModelConfig
) => {
  const nextAiConfig = { ...baseConfig } as Record<string, unknown>;

  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) {
      delete nextAiConfig[key];
      return;
    }
    nextAiConfig[key] = value;
  });

  if (!nextModelConfig) {
    return nextAiConfig as IAttachmentFieldAIConfig;
  }

  const nextIsPromptControlledModel = isPromptControlledImageGenerationModel(nextModelConfig);

  if (!supportsImageSizeSelection(nextModelConfig)) {
    delete nextAiConfig.size;
  }

  if (!supportsImageAspectRatioSelection(nextModelConfig)) {
    delete nextAiConfig.aspectRatio;
  }

  if (nextIsPromptControlledModel) {
    delete nextAiConfig.size;
  } else {
    delete nextAiConfig.resolution;
  }

  return nextAiConfig as IAttachmentFieldAIConfig;
};

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
  const generateImageAiConfig = aiConfig as IAttachmentFieldGenerateImageAIConfig | undefined;

  const {
    supportsSize,
    imageModelConfig,
    supportsQuality,
    supportsCount,
    supportsAspectRatio,
    supportsResolution,
    supportsImageInput,
    hasAdvancedOptions,
    imageSizeValues,
    aspectRatioValues,
    currentSize,
    currentQuality,
    currentCount,
    currentAspectRatio,
    currentResolution,
    maxCount,
    maxImagesPerCall,
    imageModelId,
    getSettingsUpdates,
  } = useImageModelUiState(modelKey, gatewayModels ?? [], generateImageAiConfig);

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

  const setAiConfigType = useCallback(
    (nextType: FieldAIActionType) => {
      onChange?.({ aiConfig: { type: nextType } as IAttachmentFieldAIConfig });
    },
    [onChange]
  );

  const sanitizeAdvancedImageConfigPatch = useCallback(
    (baseConfig: Record<string, unknown>, patch: IAttachmentAiConfigPatch) => {
      const nextModelKey =
        (patch.modelKey as string | undefined) ?? (baseConfig.modelKey as string | undefined);
      const nextModelConfig = nextModelKey
        ? getImageModelConfigByModelKey(nextModelKey, gatewayModels ?? [])?.config
        : undefined;

      return sanitizeAttachmentAiConfigForModel(baseConfig, patch, nextModelConfig);
    },
    [gatewayModels]
  );

  const patchAiConfig = useCallback(
    (patch: IAttachmentAiConfigPatch) => {
      onChange?.({
        aiConfig: sanitizeAdvancedImageConfigPatch(
          { ...(aiConfig ?? {}) } as Record<string, unknown>,
          patch
        ),
      });
    },
    [aiConfig, onChange, sanitizeAdvancedImageConfigPatch]
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
    const updates = getSettingsUpdates(
      isModelChanged,
      currentAiConfig as IAttachmentFieldGenerateImageAIConfig
    );

    if (Object.keys(updates).length > 0) {
      currentOnChange?.({
        aiConfig: sanitizeAdvancedImageConfigPatch(
          { ...(currentAiConfig ?? {}) } as Record<string, unknown>,
          updates
        ),
      });
    }
  }, [getSettingsUpdates, modelKey, sanitizeAdvancedImageConfigPatch, type]);

  return (
    <Fragment>
      <div className="flex flex-col gap-y-2">
        <span>{t('table:field.aiConfig.label.type')}</span>
        <Selector
          className="w-full"
          placeholder={t('table:field.aiConfig.placeholder.type')}
          selectedId={type}
          onChange={(id) => {
            setAiConfigType(id as FieldAIActionType);
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
                patchAiConfig({ modelKey: newValue });
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
                onChange={(value) => patchAiConfig({ prompt: value })}
                label={t('table:field.aiConfig.label.prompt')}
                placeholder={t('table:field.aiConfig.placeholder.prompt')}
                required={true}
                isOptionDisabled={(field) =>
                  !supportsImageInput && field.type === FieldType.Attachment
                }
                getDisabledReason={(field) =>
                  !supportsImageInput && field.type === FieldType.Attachment
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
                  disabledTypes={supportsImageInput ? [] : [FieldType.Attachment]}
                  disabledReason={t('table:field.aiConfig.hint.attachmentNotSupported')}
                  selectedId={(aiConfig as IAttachmentFieldGenerateImageAIConfig)?.sourceFieldId}
                  onChange={(fieldId) => patchAiConfig({ sourceFieldId: fieldId })}
                />
                {supportsImageInput && (
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
                    patchAiConfig({ attachPrompt: e.target.value });
                  }}
                />
              </div>
            </Fragment>
          )}

          {/* Advanced Settings - Collapsible (shared by both modes) */}
          {hasAdvancedOptions && (
            <AdvancedImageSettings
              open={advancedOpen}
              onOpenChange={setAdvancedOpen}
              imageModelId={imageModelId}
              supportsSize={supportsSize}
              supportsAutoSize={imageModelConfig?.supportsAutoSize}
              supportsQuality={supportsQuality}
              supportsAspectRatio={supportsAspectRatio}
              supportsResolution={supportsResolution}
              supportsCount={supportsCount}
              imageSizeValues={imageSizeValues}
              aspectRatioValues={aspectRatioValues}
              currentSize={currentSize}
              currentQuality={currentQuality}
              currentAspectRatio={currentAspectRatio}
              currentResolution={currentResolution}
              currentCount={currentCount}
              maxCount={maxCount}
              maxImagesPerCall={maxImagesPerCall}
              onChange={patchAiConfig}
            />
          )}
        </Fragment>
      )}
    </Fragment>
  );
};
