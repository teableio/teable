import type {
  IAttachmentFieldAIConfig,
  IAttachmentFieldCustomizeAIConfig,
  IAttachmentFieldGenerateImageAIConfig,
} from '@teable/core';
import { FieldAIActionType, FieldType, ImageQuality } from '@teable/core';
import { ImageGeneration, Pencil } from '@teable/icons';
import { Selector } from '@teable/ui-lib/base';
import { Slider, Textarea } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { Fragment, useMemo } from 'react';
import { RequireCom } from '@/features/app/blocks/setting/components/RequireCom';
import { tableConfig } from '@/features/i18n/table.config';
import type { IFieldEditorRo } from '../type';
import { FieldSelect, PromptEditorContainer } from './components';

interface IAttachmentFieldAiConfigProps {
  field: Partial<IFieldEditorRo>;
  onChange?: (partialField: Partial<IFieldEditorRo>) => void;
}

export const AttachmentFieldAiConfig = (props: IAttachmentFieldAiConfigProps) => {
  const { field, onChange } = props;
  const { id, aiConfig } = field;
  const { type } = aiConfig ?? {};

  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const candidates = useMemo(() => {
    return [
      {
        id: FieldAIActionType.ImageGeneration,
        icon: <ImageGeneration className="size-4" />,
        name: t('table:field.aiConfig.type.imageGeneration'),
      },
      {
        id: FieldAIActionType.Customization,
        icon: <Pencil className="size-4" />,
        name: t('table:field.aiConfig.type.customization'),
      },
    ];
  }, [t]);

  const onConfigChange = (
    key: keyof IAttachmentFieldGenerateImageAIConfig | keyof IAttachmentFieldCustomizeAIConfig,
    value: unknown
  ) => {
    switch (key) {
      case 'type':
        return onChange?.({ aiConfig: { type: value } as IAttachmentFieldAIConfig });
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
      case 'prompt':
        return onChange?.({
          aiConfig: { ...aiConfig, prompt: value as string } as IAttachmentFieldCustomizeAIConfig,
        });
      default:
        throw new Error(`Unsupported key: ${key}`);
    }
  };

  const imageSizeCandidates = useMemo(
    () => [
      { id: '256x256', name: '256x256' },
      { id: '512x512', name: '512x512' },
      { id: '1024x1024', name: '1024x1024' },
      { id: '1792x1024', name: '1792x1024' },
      { id: '1024x1792', name: '1024x1792' },
    ],
    []
  );

  const qualityCandidates = useMemo(
    () => [
      { id: ImageQuality.Low, name: t('table:field.aiConfig.imageQuality.low') },
      { id: ImageQuality.Medium, name: t('table:field.aiConfig.imageQuality.medium') },
      { id: ImageQuality.High, name: t('table:field.aiConfig.imageQuality.high') },
    ],
    [t]
  );

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
          {type === FieldAIActionType.Customization ? (
            <div className="flex flex-col gap-y-2">
              <PromptEditorContainer
                excludedFieldId={id}
                value={(aiConfig as IAttachmentFieldCustomizeAIConfig)?.prompt || ''}
                onChange={(value) => onConfigChange('prompt', value)}
                label={t('table:field.aiConfig.label.prompt')}
                placeholder={t('table:field.aiConfig.placeholder.prompt')}
                required={true}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-y-2">
              <span>
                {t('table:field.aiConfig.label.sourceFieldForAttachment')}
                <RequireCom />
              </span>
              <FieldSelect
                excludedIds={id ? [id] : []}
                excludeTypes={[FieldType.Attachment]}
                selectedId={(aiConfig as IAttachmentFieldGenerateImageAIConfig)?.sourceFieldId}
                onChange={(fieldId) => onConfigChange('sourceFieldId', fieldId)}
              />
            </div>
          )}
          <div className="flex flex-col gap-y-2">
            <span>{t('table:field.aiConfig.label.imageSize')}</span>
            <Selector
              className="w-full"
              placeholder={t('table:field.aiConfig.placeholder.imageSize')}
              selectedId={(aiConfig as IAttachmentFieldGenerateImageAIConfig)?.size || '1024x1024'}
              onChange={(id) => onConfigChange('size', id)}
              candidates={imageSizeCandidates}
              searchTip={t('sdk:common.search.placeholder')}
              emptyTip={t('sdk:common.search.empty')}
            />
          </div>
          <div className="flex flex-col gap-y-2">
            <span>{t('table:field.aiConfig.label.imageCount')}</span>
            <div className="flex w-full cursor-pointer justify-between gap-x-4 rounded-md border px-3 py-2">
              <Slider
                value={[(aiConfig as IAttachmentFieldGenerateImageAIConfig)?.n || 1]}
                min={1}
                max={10}
                step={1}
                className="grow"
                onValueChange={(value) => onConfigChange('n', Number(value[0]))}
              />
              <span>{(aiConfig as IAttachmentFieldGenerateImageAIConfig)?.n || 1}</span>
            </div>
          </div>
          <div className="flex flex-col gap-y-2">
            <span>{t('table:field.aiConfig.label.imageQuality')}</span>
            <Selector
              className="w-full"
              placeholder={t('table:field.aiConfig.placeholder.imageQuality')}
              selectedId={
                (aiConfig as IAttachmentFieldGenerateImageAIConfig)?.quality ?? ImageQuality.Medium
              }
              onChange={(id) => onConfigChange('quality', id)}
              candidates={qualityCandidates}
              searchTip={t('sdk:common.search.placeholder')}
              emptyTip={t('sdk:common.search.empty')}
            />
          </div>
          {type !== FieldAIActionType.Customization && (
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
          )}
        </Fragment>
      )}
    </Fragment>
  );
};
