import type {
  ISingleSelectFieldClassifyAIConfig,
  ITextFieldAIConfig,
  ITextFieldCustomizeAIConfig,
  ITextFieldExtractInfoAIConfig,
  ITextFieldImproveTextAIConfig,
  ITextFieldSummarizeAIConfig,
  ITextFieldTranslateAIConfig,
} from '@teable/core';
import { FieldAIActionType } from '@teable/core';
import { Edit, Export, Layers, Pencil, Translation } from '@teable/icons';
import { Selector } from '@teable/ui-lib/base';
import { Input, Textarea } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { Fragment, useMemo } from 'react';
import { RequireCom } from '@/features/app/blocks/setting/components/RequireCom';
import { tableConfig } from '@/features/i18n/table.config';
import type { IFieldEditorRo } from '../type';
import { AttachmentSelect, FieldSelect, PromptEditorContainer } from './components';

interface ITextFieldAiConfigProps {
  field: Partial<IFieldEditorRo>;
  onChange?: (partialField: Partial<IFieldEditorRo>) => void;
}

export const TextFieldAiConfig = (props: ITextFieldAiConfigProps) => {
  const { field, onChange } = props;
  const { id, aiConfig } = field;
  const { type } = aiConfig ?? {};

  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const candidates = useMemo(() => {
    return [
      {
        id: FieldAIActionType.Summary,
        icon: <Layers className="size-4" />,
        name: t('table:field.aiConfig.type.summary'),
      },
      {
        id: FieldAIActionType.Translation,
        icon: <Translation className="size-4" />,
        name: t('table:field.aiConfig.type.translation'),
      },
      {
        id: FieldAIActionType.Extraction,
        icon: <Export className="size-4" />,
        name: t('table:field.aiConfig.type.extraction'),
      },
      {
        id: FieldAIActionType.Improvement,
        icon: <Edit className="size-4" />,
        name: t('table:field.aiConfig.type.improvement'),
      },
      {
        id: FieldAIActionType.Customization,
        icon: <Pencil className="size-4" />,
        name: t('table:field.aiConfig.type.customization'),
      },
    ];
  }, [t]);

  const getPlaceholder = (type: FieldAIActionType) => {
    switch (type) {
      case FieldAIActionType.Translation:
        return t('table:field.aiConfig.placeholder.translate');
      case FieldAIActionType.Improvement:
        return t('table:field.aiConfig.placeholder.improveText');
      case FieldAIActionType.Extraction:
        return t('table:field.aiConfig.placeholder.extractInfo');
      case FieldAIActionType.Summary:
        return t('table:field.aiConfig.placeholder.summarize');
      case FieldAIActionType.Customization:
        return t('table:field.aiConfig.placeholder.prompt');
      default:
        return '';
    }
  };

  const onConfigChange = (
    key:
      | keyof ITextFieldExtractInfoAIConfig
      | keyof ITextFieldSummarizeAIConfig
      | keyof ITextFieldTranslateAIConfig
      | keyof ITextFieldImproveTextAIConfig
      | keyof ITextFieldCustomizeAIConfig,
    value: unknown
  ) => {
    switch (key) {
      case 'type':
        return onChange?.({ aiConfig: { type: value } as ITextFieldAIConfig });
      case 'sourceFieldId':
        return onChange?.({
          aiConfig: { ...aiConfig, sourceFieldId: value as string } as ITextFieldAIConfig,
        });
      case 'targetLanguage':
        return onChange?.({
          aiConfig: { ...aiConfig, targetLanguage: value as string } as ITextFieldTranslateAIConfig,
        });
      case 'attachPrompt':
        return onChange?.({
          aiConfig: { ...aiConfig, attachPrompt: value as string } as ITextFieldImproveTextAIConfig,
        });
      case 'prompt':
        return onChange?.({
          aiConfig: { ...aiConfig, prompt: value as string } as ITextFieldCustomizeAIConfig,
        });
      case 'attachmentFieldIds':
        return onChange?.({
          aiConfig: {
            ...aiConfig,
            attachmentFieldIds: value as string[],
          } as ITextFieldCustomizeAIConfig,
        });
      default:
        throw new Error(`Unsupported key: ${key}`);
    }
  };

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

      {type && type !== FieldAIActionType.Customization && (
        <div className="flex flex-col gap-y-2">
          <span>
            {t('table:field.aiConfig.label.sourceField')}
            <RequireCom />
          </span>
          <FieldSelect
            excludedIds={id ? [id] : []}
            selectedId={(aiConfig as ISingleSelectFieldClassifyAIConfig)?.sourceFieldId}
            onChange={(fieldId) => onConfigChange('sourceFieldId', fieldId)}
          />
        </div>
      )}

      {type === FieldAIActionType.Translation && (
        <div className="flex flex-col gap-y-2">
          <span>
            {t('table:field.aiConfig.label.targetLanguage')}
            <RequireCom />
          </span>
          <Input
            type="text"
            className="w-full"
            placeholder={t('table:field.aiConfig.placeholder.targetLanguage')}
            value={(aiConfig as ITextFieldTranslateAIConfig)?.targetLanguage || ''}
            onChange={(e) => {
              onConfigChange('targetLanguage', e.target.value);
            }}
          />
        </div>
      )}

      {type && type !== FieldAIActionType.Customization && (
        <div className="flex flex-col gap-y-2">
          <span>{t('table:field.aiConfig.label.attachPrompt')}</span>
          <Textarea
            placeholder={getPlaceholder(type)}
            className="w-full"
            value={(aiConfig as ITextFieldImproveTextAIConfig)?.attachPrompt || ''}
            onChange={(e) => {
              onConfigChange('attachPrompt', e.target.value);
            }}
          />
        </div>
      )}

      {type === FieldAIActionType.Customization && (
        <Fragment>
          <div className="flex flex-col gap-y-2">
            <PromptEditorContainer
              excludedFieldId={id}
              value={(aiConfig as ITextFieldCustomizeAIConfig)?.prompt || ''}
              onChange={(value) => onConfigChange('prompt', value)}
              label={t('table:field.aiConfig.label.prompt')}
              placeholder={t('table:field.aiConfig.placeholder.prompt')}
              required={true}
            />
          </div>
          <div className="flex flex-col gap-y-2">
            <span>{t('table:field.default.attachment.title')}</span>
            <AttachmentSelect
              value={(aiConfig as ITextFieldCustomizeAIConfig)?.attachmentFieldIds || []}
              onChange={(value) => onConfigChange('attachmentFieldIds', value)}
            />
          </div>
        </Fragment>
      )}
    </Fragment>
  );
};
