import type { IDateFieldExtractionAIConfig, IDateFieldCustomizeAIConfig } from '@teable/core';
import { FieldAIActionType } from '@teable/core';
import { Export, Pencil } from '@teable/icons';
import { Selector } from '@teable/ui-lib/base';
import { Textarea } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { Fragment, useMemo } from 'react';
import { RequireCom } from '@/features/app/blocks/setting/components/RequireCom';
import { tableConfig } from '@/features/i18n/table.config';
import type { IFieldEditorRo } from '../type';
import { AttachmentSelect, FieldSelect, PromptEditorContainer } from './components';

interface IDateFieldAiConfigProps {
  field: Partial<IFieldEditorRo>;
  onChange?: (partialField: Partial<IFieldEditorRo>) => void;
}

export const DateFieldAiConfig = (props: IDateFieldAiConfigProps) => {
  const { field, onChange } = props;
  const { id, aiConfig } = field;
  const { type } = aiConfig ?? {};

  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const candidates = useMemo(() => {
    return [
      {
        id: FieldAIActionType.Extraction,
        icon: <Export className="size-4" />,
        name: t('table:field.aiConfig.type.extraction'),
      },
      {
        id: FieldAIActionType.Customization,
        icon: <Pencil className="size-4" />,
        name: t('table:field.aiConfig.type.customization'),
      },
    ];
  }, [t]);

  const onConfigChange = (
    key: keyof IDateFieldExtractionAIConfig | keyof IDateFieldCustomizeAIConfig,
    value: unknown
  ) => {
    switch (key) {
      case 'type':
        return onChange?.({ aiConfig: { type: value } as IDateFieldExtractionAIConfig });
      case 'sourceFieldId':
        return onChange?.({
          aiConfig: { ...aiConfig, sourceFieldId: value as string } as IDateFieldExtractionAIConfig,
        });
      case 'attachPrompt':
        return onChange?.({
          aiConfig: {
            ...aiConfig,
            attachPrompt: value as string,
          } as IDateFieldExtractionAIConfig,
        });
      case 'prompt':
        return onChange?.({
          aiConfig: { ...aiConfig, prompt: value as string } as IDateFieldCustomizeAIConfig,
        });
      case 'attachmentFieldIds':
        return onChange?.({
          aiConfig: {
            ...aiConfig,
            attachmentFieldIds: value as string[],
          } as IDateFieldCustomizeAIConfig,
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
        <Fragment>
          <div className="flex flex-col gap-y-2">
            <span>
              {t('table:field.aiConfig.label.sourceField')}
              <RequireCom />
            </span>
            <FieldSelect
              excludedIds={id ? [id] : []}
              selectedId={(aiConfig as IDateFieldExtractionAIConfig)?.sourceFieldId}
              onChange={(fieldId) => onConfigChange('sourceFieldId', fieldId)}
            />
          </div>
          <div className="flex flex-col gap-y-2">
            <span>{t('table:field.aiConfig.label.attachPrompt')}</span>
            <Textarea
              placeholder={t('table:field.aiConfig.placeholder.extractDate')}
              className="w-full"
              value={(aiConfig as IDateFieldExtractionAIConfig)?.attachPrompt || ''}
              onChange={(e) => {
                onConfigChange('attachPrompt', e.target.value);
              }}
            />
          </div>
        </Fragment>
      )}
      {type === FieldAIActionType.Customization && (
        <Fragment>
          <div className="flex flex-col gap-y-2">
            <PromptEditorContainer
              excludedFieldId={id}
              value={(aiConfig as IDateFieldCustomizeAIConfig)?.prompt || ''}
              onChange={(value) => onConfigChange('prompt', value)}
              label={t('table:field.aiConfig.label.prompt')}
              placeholder={t('table:field.aiConfig.placeholder.prompt')}
              required={true}
            />
          </div>
          <div className="flex flex-col gap-y-2">
            <span>{t('table:field.default.attachment.title')}</span>
            <AttachmentSelect
              value={(aiConfig as IDateFieldCustomizeAIConfig)?.attachmentFieldIds || []}
              onChange={(value) => onConfigChange('attachmentFieldIds', value)}
            />
          </div>
        </Fragment>
      )}
    </Fragment>
  );
};
