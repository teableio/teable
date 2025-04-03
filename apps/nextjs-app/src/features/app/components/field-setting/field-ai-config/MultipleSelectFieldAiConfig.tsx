import type {
  ISingleSelectFieldClassifyAIConfig,
  ISingleSelectFieldCustomizeAIConfig,
  ISingleSelectFieldAIConfig,
  ITextFieldAIConfig,
} from '@teable/core';
import { FieldAIActionType } from '@teable/core';
import { Pencil } from '@teable/icons';
import { Selector } from '@teable/ui-lib/base';
import { Label, Textarea } from '@teable/ui-lib/shadcn';
import { TagIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { Fragment, useMemo } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { SelectFieldByTableId } from '../lookup-options/LookupOptions';
import type { IFieldEditorRo } from '../type';
import { PromptEditorContainer } from './components';

interface IMultipleSelectFieldAiConfigProps {
  field: Partial<IFieldEditorRo>;
  onChange?: (partialField: Partial<IFieldEditorRo>) => void;
}

export const MultipleSelectFieldAiConfig = (props: IMultipleSelectFieldAiConfigProps) => {
  const { field, onChange } = props;
  const { aiConfig } = field;
  const { type } = aiConfig ?? {};

  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const candidates = useMemo(() => {
    return [
      {
        id: FieldAIActionType.Tag,
        icon: <TagIcon className="size-4" />,
        name: t('table:field.aiConfig.type.tag'),
      },
      {
        id: FieldAIActionType.Customization,
        icon: <Pencil className="size-4" />,
        name: t('table:field.aiConfig.type.customization'),
      },
    ];
  }, [t]);

  const onConfigChange = (
    key: keyof ISingleSelectFieldClassifyAIConfig | keyof ISingleSelectFieldCustomizeAIConfig,
    value: unknown
  ) => {
    switch (key) {
      case 'type':
        return onChange?.({ aiConfig: { type: value } as ITextFieldAIConfig });
      case 'sourceFieldId':
        return onChange?.({
          aiConfig: { ...aiConfig, sourceFieldId: value as string } as ISingleSelectFieldAIConfig,
        });
      case 'attachPrompt':
        return onChange?.({
          aiConfig: {
            ...aiConfig,
            attachPrompt: value as string,
          } as ISingleSelectFieldClassifyAIConfig,
        });
      case 'prompt':
        return onChange?.({
          aiConfig: { ...aiConfig, prompt: value as string } as ISingleSelectFieldCustomizeAIConfig,
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

      {type && type !== FieldAIActionType.Customization && (
        <Fragment>
          <div className="flex flex-col gap-y-2">
            <Label>{t('table:field.aiConfig.label.sourceFieldForTag')}</Label>
            <SelectFieldByTableId
              selectedId={(aiConfig as ISingleSelectFieldClassifyAIConfig)?.sourceFieldId}
              onChange={(field) => {
                onConfigChange('sourceFieldId', field.id);
              }}
            />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label>{t('table:field.aiConfig.label.attachPrompt')}</Label>
            <Textarea
              placeholder={t('table:field.aiConfig.placeholder.attachPromptForTag')}
              className="w-full"
              value={(aiConfig as ISingleSelectFieldClassifyAIConfig)?.attachPrompt || ''}
              onChange={(e) => {
                onConfigChange('attachPrompt', e.target.value);
              }}
            />
          </div>
        </Fragment>
      )}

      {type === FieldAIActionType.Customization && (
        <div className="flex flex-col gap-y-2">
          <PromptEditorContainer
            value={(aiConfig as ISingleSelectFieldCustomizeAIConfig)?.prompt || ''}
            onChange={(value) => onConfigChange('prompt', value)}
            label={t('table:field.aiConfig.label.prompt')}
            placeholder={t('table:field.aiConfig.placeholder.prompt')}
          />
        </div>
      )}
    </Fragment>
  );
};
