import type {
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
import { Input, Label, Textarea } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { Fragment, useMemo } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { SelectFieldByTableId } from '../lookup-options/LookupOptions';
import type { IFieldEditorRo } from '../type';
import { PromptEditorContainer } from './components';

interface ITextFieldAiConfigProps {
  field: Partial<IFieldEditorRo>;
  onChange?: (partialField: Partial<IFieldEditorRo>) => void;
}

export const TextFieldAiConfig = (props: ITextFieldAiConfigProps) => {
  const { field, onChange } = props;
  const { aiConfig } = field;
  const { type } = aiConfig ?? {};

  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const candidates = useMemo(() => {
    return [
      {
        id: FieldAIActionType.Summarize,
        icon: <Layers className="size-4" />,
        name: t('table:field.aiConfig.type.summary'),
      },
      {
        id: FieldAIActionType.Translate,
        icon: <Translation className="size-4" />,
        name: t('table:field.aiConfig.type.translation'),
      },
      {
        id: FieldAIActionType.ExtractInfo,
        icon: <Export className="size-4" />,
        name: t('table:field.aiConfig.type.extraction'),
      },
      {
        id: FieldAIActionType.ImproveText,
        icon: <Edit className="size-4" />,
        name: t('table:field.aiConfig.type.improvement'),
      },
      {
        id: FieldAIActionType.Customize,
        icon: <Pencil className="size-4" />,
        name: t('table:field.aiConfig.type.customization'),
      },
    ];
  }, [t]);

  const getPlaceholder = (type: FieldAIActionType) => {
    switch (type) {
      case FieldAIActionType.Translate:
        return t('table:field.aiConfig.placeholder.translate');
      case FieldAIActionType.ImproveText:
        return t('table:field.aiConfig.placeholder.improveText');
      case FieldAIActionType.ExtractInfo:
        return t('table:field.aiConfig.placeholder.extractInfo');
      case FieldAIActionType.Summarize:
        return t('table:field.aiConfig.placeholder.summarize');
      case FieldAIActionType.Customize:
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
        console.log('prompt', value);
        return onChange?.({
          aiConfig: { ...aiConfig, prompt: value as string } as ITextFieldCustomizeAIConfig,
        });
      default:
        throw new Error(`Unsupported key: ${key}`);
    }
  };

  return (
    <Fragment>
      <div className="flex flex-col gap-y-2">
        <Label>{t('table:field.aiConfig.label.type')}</Label>
        <Selector
          className="w-full"
          placeholder={t('table:field.aiConfig.placeholder.type')}
          selectedId={type}
          onChange={(id) => {
            onConfigChange('type', id);
          }}
          candidates={candidates}
        />
      </div>

      {type && type !== FieldAIActionType.Customize && (
        <div className="flex flex-col gap-y-2">
          <Label>{t('table:field.aiConfig.label.sourceField')}</Label>
          <SelectFieldByTableId
            selectedId={(aiConfig as ITextFieldSummarizeAIConfig)?.sourceFieldId}
            onChange={(field) => {
              onConfigChange('sourceFieldId', field.id);
            }}
          />
        </div>
      )}

      {type === FieldAIActionType.Translate && (
        <div className="flex flex-col gap-y-2">
          <Label>{t('table:field.aiConfig.label.targetLanguage')}</Label>
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

      {type && type !== FieldAIActionType.Customize && (
        <div className="flex flex-col gap-y-2">
          <Label>{t('table:field.aiConfig.label.attachPrompt')}</Label>
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

      {type === FieldAIActionType.Customize && (
        <div className="flex flex-col gap-y-2">
          <PromptEditorContainer
            value={(aiConfig as ITextFieldCustomizeAIConfig)?.prompt || ''}
            onChange={(value) => onConfigChange('prompt', value)}
            label={t('table:field.aiConfig.label.prompt')}
            placeholder={t('table:field.aiConfig.placeholder.prompt')}
          />
        </div>
      )}
    </Fragment>
  );
};
